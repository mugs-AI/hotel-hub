import type { MasterCaptureActor } from "./n3-settlement-master-diagnostics.server";
import type { MasterCapture, MasterCaptureInput } from "./n3-settlement-master-diagnostics.server";
export type MasterCaptureDeps = {
  actor(): Promise<MasterCaptureActor | null>;
  capture(actor: MasterCaptureActor, input: MasterCaptureInput): Promise<MasterCapture>;
  endSession(): Promise<void>;
};
import { validateMasterCapture } from "./n3-settlement-master-diagnostics.server";
import { isSameOriginWrite, readJsonBody, deny } from "./operations-api.server";
export async function handleMasterCapture(
  request: Request,
  deps: MasterCaptureDeps,
): Promise<Response> {
  if (request.method !== "POST") return deny(405, "method_not_allowed");
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  try {
    const actor = await deps.actor();
    if (!actor) return deny(401, "unauthenticated");
    if (actor.role !== "owner") return deny(403, "forbidden");
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return deny(400, parsed.code);
    try {
      validateMasterCapture(parsed.body as MasterCaptureInput);
    } catch {
      return deny(400, "invalid_request");
    }
    const report = await deps.capture(actor, parsed.body as MasterCaptureInput);
    if (report.status === "unauthorized") {
      await deps.endSession();
      return deny(401, "n3_unauthorized");
    }
    return Response.json({ report }, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(503, "n3_master_capture_unavailable");
  }
}
export function liveMasterCaptureDeps(): MasterCaptureDeps {
  return {
    actor: async () => {
      const { readRequestContext } = await import("./session-context.server");
      const ctx = await readRequestContext();
      if (!ctx.authenticated || !ctx.role) return null;
      return {
        tenantId: ctx.session.tenantId!,
        n3UserKey: ctx.session.n3UserKey,
        n3Token: ctx.session.n3Token,
        role: ctx.role,
      };
    },
    capture: async (actor, input) => {
      const { captureSettlementMasters } =
        await import("./n3-settlement-master-diagnostics.server");
      const report = await captureSettlementMasters(actor, input);
      const { logAudit } = await import("./audit.server");
      await logAudit({
        tenantId: actor.tenantId,
        n3UserKey: actor.n3UserKey,
        eventType: "n3.financial_verification",
        detail: { status: report.status, count: report.evidence.length, contractAccepted: false },
      });
      return report;
    },
    endSession: async () => {
      const { destroySession } = await import("./session-context.server");
      await destroySession("n3_401");
    },
  };
}
