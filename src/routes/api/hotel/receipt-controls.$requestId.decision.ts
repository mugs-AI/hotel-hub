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
          const base = defaultReceiptControlDeps();
          const existing = await base.db.get(actor.tenantId, params.requestId);
          if (existing?.generation === 2) {
            const { resolveAutomationActor, defaultReceiptAutomationDeps } =
              await import("@/lib/receipt-automation-deps.server");
            const { validateAutomaticActionBody } =
              await import("@/lib/receipt-automation-http.server");
            const { applyReceiptCorrection } =
              await import("@/lib/receipt-automation-execution.server");
            const resolved = await resolveAutomationActor(actor),
              deps = defaultReceiptAutomationDeps();
            if (body.decision === "reject") {
              const { ReceiptControlError } = await import("@/lib/receipt-controls");
              if (
                Object.keys(body).some((k) => !["expectedVersion", "decision"].includes(k)) ||
                !Number.isSafeInteger(body.expectedVersion) ||
                Number(body.expectedVersion) < 1
              )
                throw new ReceiptControlError("invalid_body");
              await deps.freshOwner(resolved);
              const policy = await deps.policy(actor.tenantId);
              if (!policy) throw new ReceiptControlError("change_controls_unavailable");
              const row = await deps.db.authorize(
                resolved,
                params.requestId,
                body.expectedVersion as number,
                "reject",
                policy.revision,
              );
              return json({ request: await deps.dto(resolved, row) });
            }
            return json(
              await applyReceiptCorrection(
                resolved,
                { requestId: params.requestId, ...validateAutomaticActionBody(body, "approve") },
                deps,
              ),
            );
          }
          const dto = await decideReceiptControlRequest(
            actor,
            {
              requestId: params.requestId,
              expectedVersion: body.expectedVersion,
              decision: body.decision,
              note: body.note,
            },
            base,
          );
          return json({ request: dto });
        }),
    },
  },
});
