// POST /api/hotel/receipt-controls/:requestId/execute
// Owner only. Automated N3 edit/void is not proven, so this returns the manual
// instruction and never writes to N3.
import { createFileRoute } from "@tanstack/react-router";
import { json, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/execute")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (actor) => {
          const { executeReceiptControlRequest } = await import("@/lib/receipt-controls-execution.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          return json(await executeReceiptControlRequest(actor, params.requestId, defaultReceiptControlDeps()));
        }),
    },
  },
});
