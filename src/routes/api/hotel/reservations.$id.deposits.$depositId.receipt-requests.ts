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
      // GET: the saved original (GET-only N3 readback) so the dialog can show
      // and prefill the real contact/account instead of blank fields.
      GET: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const { readReceiptOriginalForDialog } =
            await import("@/lib/receipt-controls-store.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const original = await readReceiptOriginalForDialog(
            actor,
            { reservationId: params.id, depositId: params.depositId },
            defaultReceiptControlDeps(),
          );
          return json({ original });
        }),
      POST: ({ request, params }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", true, async (actor) => {
          const body = await readJson(request);
          const { createReceiptControlRequest } =
            await import("@/lib/receipt-controls-store.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const {
            automaticReceiptCreationReady,
            createAutomaticReceiptRequest,
            resolveAutomationActor,
            defaultReceiptAutomationDeps,
          } = await import("@/lib/receipt-automation-deps.server");
          if (
            (body.proposal as { kind?: unknown } | null)?.kind === "correction" &&
            (await automaticReceiptCreationReady(actor))
          ) {
            const { ReceiptControlError } = await import("@/lib/receipt-controls");
            if (
              Object.keys(body).some((k) => !["clientRequestId", "reason", "proposal"].includes(k))
            )
              throw new ReceiptControlError("invalid_body");
            const dto = await createAutomaticReceiptRequest(actor, {
              reservationId: params.id,
              depositId: params.depositId,
              clientRequestId: body.clientRequestId,
              reason: body.reason,
              proposal: body.proposal,
            });
            if (actor.role === "owner" && dto.canApply && dto.state === "pending") {
              const { applyReceiptCorrection } =
                await import("@/lib/receipt-automation-execution.server");
              return json(
                await applyReceiptCorrection(
                  await resolveAutomationActor(actor),
                  { requestId: dto.id, expectedVersion: dto.version, action: "apply" },
                  defaultReceiptAutomationDeps(),
                ),
                201,
              );
            }
            return json({ request: dto }, 201);
          }
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
