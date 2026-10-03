import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { decideBillTo } from "@/lib/folio-bill-to-controls.server";
import { ReceiptControlError } from "@/lib/receipt-controls";
export const Route = createFileRoute("/api/hotel/bill-to-changes/$requestId/decision")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:approve", true, async (actor) => {
          const b = await readJson(request);
          if (Object.keys(b).some((k) => !["expectedVersion", "decision"].includes(k)))
            throw new ReceiptControlError("invalid_body");
          return json({
            request: await decideBillTo(actor, {
              requestId: params.requestId,
              expectedVersion: b.expectedVersion as number,
              decision: b.decision as "approve" | "reject",
            }),
          });
        }),
    },
  },
});
