// POST /api/hotel/reservations/:id/deposits/:depositId/receipt-requests
// Owner or Front Desk: request a correction or void of a posted receipt.
// Reads N3 (GET-only) to snapshot the original; never writes to N3.
import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute(
  "/api/hotel/reservations/$id/deposits/$depositId/receipt-requests",
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", true, async (actor) => {
          const body = await readJson(request);
          const { createReceiptControlRequest } =
            await import("@/lib/receipt-controls-store.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const dto = await createReceiptControlRequest(
            actor,
            {
              reservationId: params.id,
              depositId: params.depositId,
              clientRequestId: body.clientRequestId,
              reason: body.reason,
              proposal: body.proposal,
            },
            defaultReceiptControlDeps(),
          );
          return json({ request: dto }, 201);
        }),
    },
  },
});
