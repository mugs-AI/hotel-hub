// HH-GOLIVE-01A UAT correction — blockers 1 & 2.
//
// Behavioural coverage (not source-text assertions) for:
//   * server-authoritative canonicalization of every Owner-submitted N3 id;
//   * fail-closed handling of unproven Tax Code / UOM contracts;
//   * server-owned resolvedAccount;
//   * no partial save when N3 validation is unavailable;
//   * N3 401 destroys the session, N3 403 does not.
import { describe, expect, it, vi } from "vitest";
import {
  CANONICALIZE_ERRORS,
  canonicalErrorStatus,
  canonicalizeAddonInput,
  canonicalizeN3Reference,
  canonicalizeSettingsPatch,
  type SelectorLoader,
} from "../n3-canonicalize.server";
import { validateSettingsPatch } from "../financial-settings";
import type { N3SelectorKind, N3SelectorLoad } from "../n3-selectors";

const STOCK_ROW = { id: "stk-1", code: "RM-SVC", name: "Room service" };
const GL_ROW = { id: "gl-1", code: "5100", name: "Rounding differences" };

function loader(overrides: Partial<Record<N3SelectorKind, N3SelectorLoad>> = {}): SelectorLoader {
  return async (kind) => {
    if (overrides[kind]) return overrides[kind]!;
    if (kind === "stock") return { status: "ok", kind, items: [STOCK_ROW], total: 1 };
    if (kind === "gl_account") return { status: "ok", kind, items: [GL_ROW], total: 1 };
    return { status: "contract_unverified", kind, missingEvidence: "unproven" };
  };
}

function patchOf(input: unknown) {
  const v = validateSettingsPatch(input);
  if (!v.ok) throw new Error(`patch rejected: ${v.code}`);
  return v.patch;
}

describe("server-authoritative N3 canonicalization", () => {
  it("rejects a fabricated stock id that is absent from the authoritative list", async () => {
    const r = await canonicalizeN3Reference("stock", "totally-made-up", loader());
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.notFound });
  });

  it("ignores browser code/name and stores the canonical N3 snapshot", async () => {
    const r = await canonicalizeAddonInput(
      {
        n3StockId: "stk-1",
        n3StockCodeSnapshot: "FAKE-CODE",
        n3StockNameSnapshot: "Fake name the browser sent",
      },
      loader(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.n3StockCodeSnapshot).toBe("RM-SVC");
    expect(r.value.n3StockNameSnapshot).toBe("Room service");
  });

  it("rejects a stock that is inactive / no longer returned by N3", async () => {
    const r = await canonicalizeAddonInput(
      { n3StockId: "stk-1" },
      loader({ stock: { status: "ok", kind: "stock", items: [], total: 0 } }),
    );
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.notFound });
  });

  it("rejects a GL account that the eligible-rounding selector did not return", async () => {
    const patch = patchOf({ rounding: { n3RoundingAccountId: "gl-bank" } });
    const r = await canonicalizeSettingsPatch(patch, loader());
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.notFound });
  });

  it("stores the canonical human snapshot for an eligible rounding account", async () => {
    const patch = patchOf({
      rounding: { n3RoundingAccountId: "gl-1", n3RoundingAccountSnapshot: "lies" },
    });
    const r = await canonicalizeSettingsPatch(patch, loader());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rounding?.n3RoundingAccountId).toBe("gl-1");
    expect(r.value.rounding?.n3RoundingAccountSnapshot).toBe("5100 — Rounding differences");
  });

  it("refuses a non-null tax code while its contract is unproven, but allows clearing", async () => {
    const bad = await canonicalizeSettingsPatch(
      patchOf({ serviceTax: { accommodation: { n3TaxCodeId: "tax-1" } } }),
      loader(),
    );
    expect(bad).toEqual({ ok: false, code: CANONICALIZE_ERRORS.contractUnverified });
    expect(canonicalErrorStatus(CANONICALIZE_ERRORS.contractUnverified)).toBe(422);

    const cleared = await canonicalizeSettingsPatch(
      patchOf({ exempt: { n3TaxCodeId: null, n3TaxCodeSnapshot: null } }),
      loader(),
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.exempt?.n3TaxCodeId).toBeNull();
  });

  it("refuses a non-null unit of measure while its contract is unproven", async () => {
    const r = await canonicalizeAddonInput({ n3UomId: "uom-1" }, loader());
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.contractUnverified });
  });

  it("never accepts a browser-supplied resolvedAccount", async () => {
    const patch = patchOf({
      postingMappings: {
        service_charge: { resolvedAccount: { id: "gl-1", code: "5100", name: "x" } },
      },
    });
    const r = await canonicalizeSettingsPatch(patch, loader());
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.resolvedAccountServerOwned });
  });

  it("canonicalizes a posting-mapping stock and blanks resolvedAccount", async () => {
    const patch = patchOf({
      postingMappings: {
        service_charge: {
          enabled: true,
          stock: { id: "stk-1", code: "WRONG", name: "WRONG" },
          resolvedAccount: { id: null, code: null, name: null },
        },
      },
    });
    const r = await canonicalizeSettingsPatch(patch, loader());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.postingMappings?.service_charge?.stock).toEqual({
      id: "stk-1",
      code: "RM-SVC",
      name: "Room service",
    });
    expect(r.value.postingMappings?.service_charge?.resolvedAccount?.id).toBeNull();
  });

  it("saves nothing when N3 validation is unavailable", async () => {
    const unavailable = loader({ stock: { status: "unavailable", kind: "stock" } });
    const r = await canonicalizeAddonInput({ n3StockId: "stk-1" }, unavailable);
    expect(r).toEqual({ ok: false, code: CANONICALIZE_ERRORS.unavailable });
    expect(canonicalErrorStatus(CANONICALIZE_ERRORS.unavailable)).toBe(503);

    const noLoader = await canonicalizeAddonInput({ n3StockId: "stk-1" }, undefined);
    expect(noLoader).toEqual({ ok: false, code: CANONICALIZE_ERRORS.unavailable });
  });
});

describe("posting mappings cannot be silently discarded", () => {
  it("fails loudly when the staged posting_mappings column is absent", async () => {
    vi.resetModules();
    const store = await import("../folio-store.server");
    const missingColumn = { message: 'column "posting_mappings" of relation does not exist' };
    const db = {
      from() {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
          update: () => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => ({ error: missingColumn }) }) }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ error: missingColumn }) }) }),
        };
      },
    };
    await expect(
      store.patchFinancialSettings(
        "tenant-1",
        {
          postingMappings: {
            service_charge: { enabled: true, stock: { id: "stk-1", code: "x", name: "y" } },
          },
        },
        "actor",
        db as never,
        loader(),
      ),
    ).rejects.toMatchObject({ code: "posting_mappings_storage_unavailable" });
  });
});

describe("N3 401 versus 403 in the selector path", () => {
  const forbiddenBody = { status: 403, body: {} };
  const unauthorizedBody = { status: 401, body: {} };

  async function loadGl(res: { status: number; body: unknown }) {
    vi.resetModules();
    vi.doMock("../n3-gateway.server", () => ({
      callN3Path: async () => res,
      listAllN3Stocks: async () => ({ items: [], total: 0 }),
      N3ListError: class extends Error {},
    }));
    const mod = await import("../n3-selectors.server");
    return { mod, run: () => mod.loadN3Selector("token", "gl_account") };
  }

  it("treats 401 as token expiry (session-destroying path)", async () => {
    const { mod, run } = await loadGl(unauthorizedBody);
    await expect(run()).rejects.toBeInstanceOf(mod.N3SelectorUnauthorized);
    vi.doUnmock("../n3-gateway.server");
  });

  it("treats 403 as forbidden and never as token expiry", async () => {
    const { mod, run } = await loadGl(forbiddenBody);
    await expect(run()).rejects.toBeInstanceOf(mod.N3SelectorForbidden);
    await expect(run()).rejects.not.toBeInstanceOf(mod.N3SelectorUnauthorized);
    vi.doUnmock("../n3-gateway.server");
  });

  it("the write-path loader never throws — it fails closed as unavailable", async () => {
    const { mod } = await loadGl(forbiddenBody);
    const load = mod.serverSelectorLoader("token");
    await expect(load("gl_account")).resolves.toEqual({
      status: "unavailable",
      kind: "gl_account",
    });
    vi.doUnmock("../n3-gateway.server");
  });
});
