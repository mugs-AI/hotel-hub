import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { ReceiptControlError } from "@/lib/receipt-controls";
import {
  resolveAutomationActor,
  defaultReceiptAutomationDeps,
} from "@/lib/receipt-automation-deps.server";
import { checkReceiptCorrectionResult } from "@/lib/receipt-automation-execution.server";
export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/check-result")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (actor) => {
          if (Object.keys(await readJson(request)).length)
            throw new ReceiptControlError("invalid_body");
          return json(
            await checkReceiptCorrectionResult(
              await resolveAutomationActor(actor),
              params.requestId,
              defaultReceiptAutomationDeps(),
            ),
          );
        }),
    },
  },
});
