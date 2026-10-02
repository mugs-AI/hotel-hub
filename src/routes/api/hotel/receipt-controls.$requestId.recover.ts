// POST /api/hotel/receipt-controls/:requestId/recover  { expectedVersion }
// Owner only. Releases a stale interrupted verification claim. No N3 call.
import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/recover")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (actor) => {
          const body = await readJson(request);
          const { recoverReceiptControlRequest } =
            await import("@/lib/receipt-controls-execution.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const dto = await recoverReceiptControlRequest(
            actor,
            { requestId: params.requestId, expectedVersion: body.expectedVersion },
            defaultReceiptControlDeps(),
          );
          return json({ request: dto });
        }),
    },
  },
});
