import type { SettlementRpc } from "./settlement-store.server";
import { createSettlementStore } from "./settlement-store.server";
import {
  readSettlementStatus,
  runSettlementStep,
  reconcileSettlement,
  type SettlementDeps,
} from "./settlement-coordinator.server";
import { billingPayloadDigest } from "./n3-billing.server";
import type { SettlementActor } from "./settlement-context.server";
import type { SettlementHttpDeps } from "./settlement-http.server";
import { readRequestContext, destroySession } from "./session-context.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
export function liveSettlementDeps(): SettlementDeps {
  const store = createSettlementStore(async (name, args) => {
    const s = await db();
    return (s as unknown as { rpc: SettlementRpc }).rpc(name, args);
  });
  return {
    store,
    now: () => new Date(),
    invalidateSession: async () => {
      await destroySession("n3_unauthorized");
    },
    async snapshot(actor, frozen) {
      const s = await db();
      if (frozen) {
        const sources = await (s as unknown as { rpc: SettlementRpc }).rpc(
          "hotelhub_settlement_sources",
          {
            p_tenant_id: actor.tenantId,
            p_reservation_id: actor.reservationId,
          },
        );
        if (sources.error) return { kind: "unavailable", code: "settlement_setup_required" };
        if (billingPayloadDigest(sources.data) !== billingPayloadDigest(frozen.sourceVersions))
          return { kind: "contradiction", code: "settlement_snapshot_changed" };
      }
      // Local mappings contain strings/snapshots, not an accepted current N3
      // currency/stock/UOM/tax/GL contract. Never promote them to posting authority.
      // The proof job must install and test the current master-response adapter
      // together with the reviewed contract; no gate/environment fallback exists.
      return { kind: "unavailable", code: "n3_settlement_master_contract_unverified" };
    },
  };
}
export function liveSettlementHttpDeps(): SettlementHttpDeps {
  const deps = liveSettlementDeps();
  return {
    async actor() {
      const ctx = await readRequestContext();
      if (!ctx.authenticated || !ctx.role) return null;
      return {
        tenantId: ctx.session.tenantId!,
        reservationId: "",
        n3UserKey: ctx.session.n3UserKey,
        n3Token: ctx.session.n3Token,
        role: ctx.role,
      };
    },
    async exists(actor: SettlementActor) {
      const s = await db();
      const r = await s
        .from("hotel_reservations")
        .select("id")
        .eq("tenant_id", actor.tenantId)
        .eq("id", actor.reservationId)
        .maybeSingle();
      if (r.error) throw new Error("settlement_store_unavailable");
      return Boolean(r.data);
    },
    services: {
      read: (a) => readSettlementStatus(a, deps),
      step: (a, input) => runSettlementStep(a, input, deps),
      reconcile: (a, id) => reconcileSettlement(a, id, deps),
    },
  };
}
