import type { SettlementActor } from "./settlement-context.server";
import type {
  EvidenceResult,
  LinkedReceipt,
  SettlementSnapshot,
  SourceVersion,
} from "./settlement";
import type { SourceBillPlan } from "./source-billing";
import type { SourceBillStore } from "./source-billing-store.server";
import type { SourceConfirmationDeps } from "./source-billing-confirmation.server";
import type { SourceBillingHttpDeps } from "./source-billing-http.server";
import { createSourceBillingServices } from "./source-billing-confirmation.server";
import { createSourceBillStore } from "./source-billing-store.server";
import {
  loadFrozenSourceLeg,
  type FrozenSourceDeps,
  type FrozenSourceState,
  type FrozenPreparation,
} from "./source-billing-frozen.server";
import { billingPayloadDigest, n3BillingClient, type BillingReadLimit } from "./n3-billing.server";
import { proveReceiptBefore } from "./settlement-evidence.server";
import { createCurrentSettlementMasters } from "./settlement-current-masters.server";
import { prepareLiveSourceBill } from "./source-billing-preparation.server";
import { readRequestContext, destroySession } from "./session-context.server";
export type SourceProductionPorts = {
  store: SourceBillStore;
  prepare(a: SettlementActor): Promise<EvidenceResult<SourceBillPlan>>;
  readLegacy(a: SettlementActor): Promise<boolean>;
  readFrozenState(a: SettlementActor): Promise<FrozenSourceState>;
  masters(a: SettlementActor): FrozenSourceDeps["masters"];
  verifyReceipt(
    a: SettlementActor,
    s: SettlementSnapshot,
    r: LinkedReceipt,
  ): Promise<EvidenceResult<LinkedReceipt>>;
  now(): Date;
  invalidateSession(reason: string): Promise<void>;
};
export function createSourceBillingProductionDeps(
  p: SourceProductionPorts,
): SourceConfirmationDeps {
  return {
    prepare: p.prepare,
    readLegacy: p.readLegacy,
    billing: {
      store: p.store,
      async legDeps(a, leg) {
        const bound = Object.freeze({ ...a }),
          saved = structuredClone(leg),
          masters = p.masters(bound);
        return {
          now: p.now,
          invalidateSession: p.invalidateSession,
          async snapshot(current, frozen) {
            if (
              ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"].some(
                (k) => current[k as keyof SettlementActor] !== bound[k as keyof SettlementActor],
              ) ||
              (frozen && billingPayloadDigest(frozen) !== billingPayloadDigest(saved.snapshot))
            )
              return { kind: "contradiction", code: "settlement_scope_mismatch" };
            return loadFrozenSourceLeg(current, saved, {
              readState: p.readFrozenState,
              masters,
              verifyReceipt: p.verifyReceipt,
              now: p.now,
            });
          },
        };
      },
    },
  };
}
interface FrozenQuery {
  select(columns: string, options?: { count: "exact" }): FrozenQuery;
  eq(column: string, value: unknown): FrozenQuery;
  order(column: string, options: { ascending: boolean }): FrozenQuery;
  limit(
    n: number,
  ): PromiseLike<{ data: Record<string, unknown>[] | null; count: number | null; error: unknown }>;
}
export type FrozenSourceDb = {
  from(table: string): FrozenQuery;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};
/** Bounded service-only reads. Current raw fingerprints fence the immutable
 * freeze transaction, including effective receipts, bill-to and configuration. */
export async function readFrozenSourceState(
  a: SettlementActor,
  store: SourceBillStore,
  db: FrozenSourceDb,
): Promise<FrozenSourceState> {
  const stay = await store.read(a);
  if (!stay) throw Error("settlement_not_found");
  const s = stay.plan.legs[0].snapshot;
  async function row(
    table: string,
    columns: string,
    filters: Record<string, unknown>,
    latest = false,
  ) {
    let q = db
      .from(table)
      .select("tenant_id," + columns, { count: "exact" })
      .eq("tenant_id", a.tenantId);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (latest) q = q.order("revision", { ascending: false });
    const r = await q.limit(latest ? 1 : 2);
    if (
      r.error ||
      !Array.isArray(r.data) ||
      r.count === null ||
      r.count < 0 ||
      !Number.isSafeInteger(r.count) ||
      (!latest && r.count !== r.data.length) ||
      r.data.length > 1 ||
      r.data.some(
        (x) => x.tenant_id !== a.tenantId || Object.entries(filters).some(([k, v]) => x[k] !== v),
      )
    )
      throw Error("settlement_frozen_read_unavailable");
    return r.data[0] ?? null;
  }
  const [r, f, p, versions] = await Promise.all([
    row("hotel_reservations", "id,status", { id: a.reservationId }),
    row("hotel_folios", "id,reservation_id,status", {
      id: s.folioId,
      reservation_id: a.reservationId,
    }),
    row(
      "hotel_billing_preparations",
      "reservation_id,folio_id,revision,property_date,source_versions,lines,total_cents,digest",
      { reservation_id: a.reservationId, folio_id: s.folioId },
      true,
    ),
    db.rpc("hotelhub_settlement_sources", {
      p_tenant_id: a.tenantId,
      p_reservation_id: a.reservationId,
    }),
  ]);
  if (
    versions.error ||
    !Array.isArray(versions.data) ||
    versions.data.length > 30000 ||
    JSON.stringify(versions.data).length > 2000000
  )
    throw Error("settlement_frozen_read_unavailable");
  const preparation: FrozenPreparation | null = p
    ? {
        tenantId: String(p.tenant_id),
        reservationId: String(p.reservation_id),
        folioId: String(p.folio_id),
        billDate: String(p.property_date),
        sourceVersions: p.source_versions as SourceVersion[],
        lines: p.lines as FrozenPreparation["lines"],
        totalCents: Number(p.total_cents),
        digest: String(p.digest),
      }
    : null;
  return {
    stay,
    preparation,
    sourceVersions: versions.data as SourceVersion[],
    status: String(r?.status),
    folioStatus: String(f?.status),
  };
}
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
export function liveSourceBillingHttpDeps(): SourceBillingHttpDeps {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const s = await db();
    return s.rpc(name as never, args as never);
  };
  const store = createSourceBillStore(rpc);
  const limit: BillingReadLimit = {
    deadlineAt: Date.now() + 30000,
    signal: new AbortController().signal,
    budget: { remainingBytes: 2000000 },
  };
  const invalidateSession = async () => {
    await destroySession("n3_unauthorized");
  };
  const deps = createSourceBillingProductionDeps({
    store,
    prepare: prepareLiveSourceBill,
    async readLegacy(a) {
      const r = await rpc("hotelhub_settlement_read", {
        p_tenant_id: a.tenantId,
        p_reservation_id: a.reservationId,
      });
      if (r.error) throw Error("settlement_setup_required");
      return r.data !== null;
    },
    async readFrozenState(a) {
      return readFrozenSourceState(a, store, (await db()) as unknown as FrozenSourceDb);
    },
    masters: (a) => createCurrentSettlementMasters(a, { invalidateSession }),
    now: () => new Date(),
    invalidateSession,
    async verifyReceipt(a, s, r) {
      try {
        const detail = await n3BillingClient.readReceipt(a, r.receiptId, limit);
        if (detail.kind === "response" && detail.status === 401) {
          await invalidateSession();
          return { kind: "unavailable", code: "n3_session_expired" };
        }
        const journal = await n3BillingClient.readReceiptJournal(a, r.receiptId, limit);
        if (journal.kind === "response" && journal.status === 401) {
          await invalidateSession();
          return { kind: "unavailable", code: "n3_session_expired" };
        }
        const result = proveReceiptBefore(s, r, detail, journal, a);
        return result.kind === "confirmed" ? { kind: "confirmed", value: r } : result;
      } catch {
        return { kind: "unavailable", code: "n3_receipt_read_unavailable" };
      }
    },
  });
  return {
    async actor() {
      const c = await readRequestContext();
      return c.authenticated && c.role
        ? {
            tenantId: c.session.tenantId!,
            reservationId: "",
            n3UserKey: c.session.n3UserKey,
            n3Token: c.session.n3Token,
            role: c.role,
          }
        : null;
    },
    async exists(a) {
      const s = await db(),
        r = await s
          .from("hotel_reservations")
          .select("id")
          .eq("tenant_id", a.tenantId)
          .eq("id", a.reservationId)
          .maybeSingle();
      if (r.error) throw Error("settlement_store_unavailable");
      return !!r.data;
    },
    services: createSourceBillingServices(deps),
  };
}
