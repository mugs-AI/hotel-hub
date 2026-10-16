import { readRequestContext } from "./session-context.server";
import { liveSourcePolicyStore } from "./source-billing-policy-store.server";
import type { SourcePolicyHttpDeps } from "./source-policy-http.server";
export function liveSourcePolicyHttpDeps(): SourcePolicyHttpDeps {
  return {
    store: liveSourcePolicyStore(),
    async actor() {
      const c = await readRequestContext();
      if (!c.authenticated || !c.role) return null;
      return {
        tenantId: c.session.tenantId!,
        reservationId: "",
        role: c.role,
        n3UserKey: c.session.n3UserKey,
        n3Token: c.session.n3Token,
      };
    },
    async exists(kind, id, a) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const r = await supabaseAdmin
        .from(kind === "policy" ? "hotel_booking_sources" : "hotel_reservations")
        .select("id")
        .eq("tenant_id", a.tenantId)
        .eq("id", id)
        .maybeSingle();
      if (r.error) throw Error("source_billing_store_unavailable");
      return Boolean(r.data);
    },
  };
}
