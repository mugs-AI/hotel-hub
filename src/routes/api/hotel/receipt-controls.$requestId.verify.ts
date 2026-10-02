// POST /api/hotel/receipt-controls/:requestId/verify  { expectedVersion }
// Owner only. GET-only N3 readback after the manual change; records the outcome.
import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/verify")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (actor) => {
          const body = await readJson(request);
          const { verifyReceiptControlRequest } =
            await import("@/lib/receipt-controls-execution.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const dto = await verifyReceiptControlRequest(
            actor,
            { requestId: params.requestId, expectedVersion: body.expectedVersion },
            defaultReceiptControlDeps(),
          );
          return json({ request: dto });
        }),
    },
  },
});
