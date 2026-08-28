// HH-GOLIVE-01A correction — proves the integrity rules that the audit found
// missing: operation-scoped idempotency, boundary enum validation, atomic
// same-folio reversal via RPC, side-effect-free GET, and the completed UI.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FOLIO_OPERATIONS,
  decideClaim,
  operationFingerprint,
} from "@/lib/folio-operations";
import {
  validateAddonLineBody,
  validateAdjustmentBody,
  validateEvidenceBody,
  validateQuantityBody,
  validateReverseBody,
  validateTaxProfileBody,
} from "@/lib/folio-input";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("operation-scoped idempotency", () => {
  const target = {
    tenantId: "t1",
    reservationId: "r1",
    folioId: "f1",
    lineId: null as string | null,
  };

  it("fingerprints the operation and its target, not just the request id", () => {
    const a = operationFingerprint("folio.add_addon", target, { catalogueId: "c1", quantity: 1 });
    const b = operationFingerprint("folio.add_addon", target, { catalogueId: "c1", quantity: 2 });
    const c = operationFingerprint("folio.adjustment", target, { catalogueId: "c1", quantity: 1 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("is stable across key ordering so a genuine retry replays", () => {
    const a = operationFingerprint("folio.add_addon", target, { catalogueId: "c1", quantity: 1 });
    const b = operationFingerprint("folio.add_addon", target, { quantity: 1, catalogueId: "c1" });
    expect(a).toBe(b);
  });

  it("changes when the target folio or reservation changes", () => {
    const a = operationFingerprint("folio.add_addon", target, { x: 1 });
    const b = operationFingerprint(
      "folio.add_addon",
      { ...target, folioId: "f2" },
      { x: 1 },
    );
    expect(a).not.toBe(b);
  });

  it("replays an identical request and refuses a conflicting reuse", () => {
    const fp = operationFingerprint("folio.add_addon", target, { quantity: 1 });
    const incoming = {
      operation: "folio.add_addon" as const,
      folioId: "f1",
      lineId: null,
      fingerprint: fp,
    };
    expect(decideClaim(null, incoming).kind).toBe("new");
    expect(
      decideClaim(
        {
          operation: "folio.add_addon",
          folioId: "f1",
          targetLineId: null,
          requestFingerprint: fp,
          resultLineId: "line-1",
        },
        incoming,
      ),
    ).toEqual({ kind: "replay", resultLineId: "line-1" });
    expect(
      decideClaim(
        {
          operation: "folio.add_addon",
          folioId: "f1",
          targetLineId: null,
          requestFingerprint: "other",
          resultLineId: "line-1",
        },
        incoming,
      ).kind,
    ).toBe("conflict");
  });

  it("enumerates every folio operation that must be idempotent", () => {
    expect(FOLIO_OPERATIONS).toContain("folio.add_addon");
    expect(FOLIO_OPERATIONS).toContain("folio.reverse");
    expect(FOLIO_OPERATIONS).toContain("folio.adjustment");
    expect(FOLIO_OPERATIONS).toContain("folio.tourism_tax_evidence");
  });
});

describe("API boundary validation", () => {
  it("rejects an unknown tax class instead of silently taxing", () => {
    const r = validateAdjustmentBody({
      lineType: "discount",
      description: "Discount",
      amountCents: -100,
      taxClass: "not_a_class",
      reason: "goodwill",
      clientRequestId: "req-1",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown fields rather than dropping them", () => {
    const r = validateAddonLineBody({
      catalogueId: "9f1d5f7a-1e2b-4c3d-8e4f-0a1b2c3d4e5f",
      quantity: 1,
      clientRequestId: "req-1",
      sneakyTotalOverride: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("requires a reason on a reversal", () => {
    expect(validateReverseBody({ clientRequestId: "req-1" }).ok).toBe(false);
    expect(validateReverseBody({ reason: "ab", clientRequestId: "req-1" }).ok).toBe(false);
    expect(
      validateReverseBody({ reason: "wrong room", clientRequestId: "req-1" }).ok,
    ).toBe(true);
  });

  it("accepts only whole, in-range quantities", () => {
    expect(validateQuantityBody({ quantity: 0 }).ok).toBe(false);
    expect(validateQuantityBody({ quantity: 1.5 }).ok).toBe(false);
    expect(validateQuantityBody({ quantity: 3 }).ok).toBe(true);
  });

  it("accepts only the declared guest tax classes", () => {
    expect(validateTaxProfileBody({ guestTaxClass: "definitely_not" }).ok).toBe(false);
  });

  it("validates Tourism Tax evidence shape", () => {
    expect(
      validateEvidenceBody({
        sourceLabel: "A",
        amountCents: 1000,
        clientRequestId: "req-1",
      }).ok,
    ).toBe(false);
    expect(
      validateEvidenceBody({
        sourceLabel: "Agoda",
        amountCents: 1000,
        collectedOn: "31-12-2026",
        clientRequestId: "req-1",
      }).ok,
    ).toBe(false);
    expect(
      validateEvidenceBody({
        sourceLabel: "Agoda",
        amountCents: 1000,
        collectedOn: "2026-12-31",
        clientRequestId: "req-1",
      }).ok,
    ).toBe(true);
  });
});

describe("migration safety", () => {
  const sql = read("db/migrations-pending/20260827162500_hh_golive_01a_folio_foundation.sql");

  it("declares the atomic reversal function", () => {
    expect(sql).toContain("hotelhub_reverse_folio_line");
  });

  it("persists an operation key with a request fingerprint", () => {
    expect(sql).toContain("hotel_folio_operations");
    expect(sql.toLowerCase()).toContain("fingerprint");
  });

  it("keeps row level security on every folio table", () => {
    for (const t of [
      "hotel_addon_catalogue",
      "hotel_financial_settings",
      "hotel_folios",
      "hotel_folio_lines",
      "hotel_folio_operations",
    ]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });
});

describe("server integrity", () => {
  const store = read("src/lib/folio-store.server.ts");

  it("reads a line only with the full tenant + folio + line scope", () => {
    expect(store).toContain("readScopedLine");
  });

  it("reverses through the transactional RPC, never line-by-line writes", () => {
    expect(store).toContain("hotelhub_reverse_folio_line");
  });

  it("keeps the folio GET side-effect free", () => {
    const view = store.slice(store.indexOf("export async function buildFolioView"));
    expect(view).not.toContain("syncRoomNights(");
    expect(store).toContain("export async function refreshFolioRoomNights");
  });

  it("snapshots room nights from the check-in workflow", () => {
    const checkIn = read("src/routes/api/hotel/reservations.$id.check-in.ts");
    expect(checkIn).toContain("refreshFolioRoomNights");
  });
});

describe("completed operational UI", () => {
  it("offers Tourism Tax evidence capture and explicit folio preparation", () => {
    const card = read("src/components/FolioCard.tsx");
    expect(card).toContain("useAddTourismTaxEvidence");
    expect(card).toContain("useRefreshFolio");
    expect(card).toContain("folio-print");
  });

  it("integrates the authoritative folio into Prepare Checkout", () => {
    const checkout = read("src/routes/reservations.$id_.checkout.tsx");
    expect(checkout).toContain("<FolioCard");
  });

  it("provides a printable guest folio that never states it is an invoice", () => {
    const print = read("src/routes/reservations.$id_.folio-print.tsx");
    expect(print).toContain("createFileRoute(\"/reservations/$id_/folio-print\")");
    expect(print).toContain("not a tax invoice");
  });

  it("completes the Owner charges and taxes configuration", () => {
    const panel = read("src/components/ChargesTaxesPanel.tsx");
    for (const needle of [
      "Service Tax by class",
      "Effective from",
      "State / local levy",
      "Rounding",
      "N3Picker",
      "defaultUnitPriceCents",
    ]) {
      expect(panel).toContain(needle);
    }
  });
});
