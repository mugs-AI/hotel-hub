import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { liveOperationControlsStore } from "@/lib/operation-controls.server";
import { OperationControlsError } from "@/lib/operation-controls";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";
function failure(error: unknown) {
  const code =
    error instanceof OperationControlsError ? error.code : "operation_controls_unavailable";
  return deny(
    code === "forbidden"
      ? 403
      : code === "invalid_request"
        ? 400
        : code === "operation_controls_stale"
          ? 409
          : 503,
    code,
  );
}
export async function handleGetOperationControls(): Promise<Response> {
  const { ctx, decision } = await requirePermission("app:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  try {
    const controls = await liveOperationControlsStore().read({
      tenantId: ctx.session.tenantId!,
      n3UserKey: ctx.session.n3UserKey,
      role: ctx.role,
    });
    return Response.json({ controls }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
export async function handlePatchOperationControls({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  const body = await readJsonBody(request);
  if (!body.ok) return deny(400, body.code);
  if (
    rejectUnknown(body.body, new Set(["rateChangeEnabled", "expectedRevision"])) !== null ||
    typeof body.body.rateChangeEnabled !== "boolean" ||
    typeof body.body.expectedRevision !== "string"
  )
    return deny(400, "invalid_request");
  try {
    const controls = await liveOperationControlsStore().update(
      { tenantId: ctx.session.tenantId!, n3UserKey: ctx.session.n3UserKey, role: ctx.role },
      {
        rateChangeEnabled: body.body.rateChangeEnabled,
        expectedRevision: body.body.expectedRevision,
      },
    );
    return Response.json({ controls }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
export const Route = createFileRoute("/api/hotel/operation-controls")({
  server: { handlers: { GET: handleGetOperationControls, PATCH: handlePatchOperationControls } },
});
