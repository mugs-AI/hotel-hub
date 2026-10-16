import type { SettlementRpc } from "./settlement-store.server";
import { createSettlementStore } from "./settlement-store.server";
import {
  readSettlementStatus,
  runSettlementStep,
  reconcileSettlement,
  type SettlementDeps,
} from "./settlement-coordinator.server";
import { loadLivePreparedSettlementSnapshot } from "./settlement-production-adapter.server";
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
    snapshot: (actor, frozen) => loadLivePreparedSettlementSnapshot(actor, frozen),
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
