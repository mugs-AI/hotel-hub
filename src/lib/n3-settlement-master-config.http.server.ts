import type { ConfiguredMasterIds } from "./n3-settlement-master-config.server";
import type { MasterCaptureActor } from "./n3-settlement-master-diagnostics.server";
export type ConfiguredMasterDeps = {
  actor(): Promise<MasterCaptureActor | null>;
  load(tenantId: string): Promise<ConfiguredMasterIds>;
};
import { isSameOriginWrite, deny } from "./operations-api.server";
export async function handleConfiguredMasterIds(
  request: Request,
  deps: ConfiguredMasterDeps,
): Promise<Response> {
  if (request.method !== "GET") return deny(405, "method_not_allowed");
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  if (new URL(request.url).search) return deny(400, "invalid_request");
  try {
    const actor = await deps.actor();
    if (!actor) return deny(401, "unauthenticated");
    if (actor.role !== "owner") return deny(403, "forbidden");
    const configured = await deps.load(actor.tenantId);
    return Response.json({ configured }, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(503, "configured_master_read_unavailable");
  }
}
export function liveConfiguredMasterDeps(): ConfiguredMasterDeps {
  return {
    actor: async () => {
      const { liveMasterCaptureDeps } =
        await import("./n3-settlement-master-diagnostics.http.server");
      return liveMasterCaptureDeps().actor();
    },
    load: async (tenantId) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { loadConfiguredMasterIds } = await import("./n3-settlement-master-config.server");
      return loadConfiguredMasterIds(
        tenantId,
        supabaseAdmin as unknown as import("./n3-settlement-master-config.server").ConfiguredMasterDb,
      );
    },
  };
}
