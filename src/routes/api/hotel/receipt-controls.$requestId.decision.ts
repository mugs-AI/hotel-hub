// POST /api/hotel/receipt-controls/:requestId/decision  { decision, expectedVersion, note? }
// Owner only. Approval never changes totals; it holds instead when N3 changed.
import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/decision")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:approve", true, async (actor) => {
          const body = await readJson(request);
          const { decideReceiptControlRequest } =
            await import("@/lib/receipt-controls-store.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const dto = await decideReceiptControlRequest(
            actor,
            {
              requestId: params.requestId,
              expectedVersion: body.expectedVersion,
              decision: body.decision,
              note: body.note,
            },
            defaultReceiptControlDeps(),
          );
          return json({ request: dto });
        }),
    },
  },
});
