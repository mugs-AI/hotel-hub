// POST /api/hotel/receipt-controls/:requestId/execute
// Owner only. Automated N3 edit/void is not proven, so this returns the manual
// instruction and never writes to N3.
import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls/$requestId/execute")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (actor) => {
          const { executeReceiptControlRequest } =
            await import("@/lib/receipt-controls-execution.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const base = defaultReceiptControlDeps();
          const row = await base.db.get(actor.tenantId, params.requestId);
          if (row?.generation === 2) {
            const { resolveAutomationActor, defaultReceiptAutomationDeps } =
              await import("@/lib/receipt-automation-deps.server");
            const { validateAutomaticActionBody } =
              await import("@/lib/receipt-automation-http.server");
            const { applyReceiptCorrection } =
              await import("@/lib/receipt-automation-execution.server");
            return json(
              await applyReceiptCorrection(
                await resolveAutomationActor(actor),
                {
                  requestId: params.requestId,
                  ...validateAutomaticActionBody(await readJson(request), "apply"),
                },
                defaultReceiptAutomationDeps(),
              ),
            );
          }
          return json(await executeReceiptControlRequest(actor, params.requestId, base));
        }),
    },
  },
});
