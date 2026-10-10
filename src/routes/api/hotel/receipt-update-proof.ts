import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { ReceiptControlError } from "@/lib/receipt-controls";
import {
  defaultReceiptProofDeps,
  resolveAutomationActor,
} from "@/lib/receipt-update-proof-deps.server";
import {
  prepareReceiptUpdateProof,
  runReceiptUpdateProof,
  checkReceiptUpdateProof,
  receiptProofCases,
  readReceiptUpdateProofPermit,
} from "@/lib/receipt-update-proof.server";
export const Route = createFileRoute("/api/hotel/receipt-update-proof")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "n3:financial_verify", false, async (a) => {
          const actor = await resolveAutomationActor(a),
            deps = defaultReceiptProofDeps();
          const permitId = new URL(request.url).searchParams.get("permitId");
          return json(
            permitId
              ? new URL(request.url).searchParams.get("action") === "check"
                ? await checkReceiptUpdateProof(actor, permitId, deps)
                : await readReceiptUpdateProofPermit(actor, permitId, deps)
              : { cases: receiptProofCases(actor, deps), enabled: deps.enabled },
          );
        }),
      POST: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:execute", true, async (a) => {
          const b = (await readJson(request)) as Record<string, unknown>;
          if (!b || typeof b !== "object" || Array.isArray(b))
            throw new ReceiptControlError("invalid_body");
          const actor = await resolveAutomationActor(a),
            deps = defaultReceiptProofDeps();
          if (
            b.action === "prepare" &&
            Object.keys(b).every((k) =>
              ["action", "caseId", "receiptId", "approvedPackageHash"].includes(k),
            ) &&
            [b.caseId, b.receiptId, b.approvedPackageHash].every((v) => typeof v === "string")
          )
            return json(
              await prepareReceiptUpdateProof(
                actor,
                {
                  caseId: b.caseId as string,
                  receiptId: b.receiptId as string,
                  approvedPackageHash: b.approvedPackageHash as string,
                },
                deps,
              ),
            );
          if (
            b.action === "run" &&
            Object.keys(b).every((k) => ["action", "permitId"].includes(k)) &&
            typeof b.permitId === "string"
          )
            return json(await runReceiptUpdateProof(actor, b.permitId, deps));
          throw new ReceiptControlError("invalid_body");
        }),
    },
  },
});
