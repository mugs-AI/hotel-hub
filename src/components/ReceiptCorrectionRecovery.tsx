import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReceiptAutomationDTO } from "@/lib/receipt-automation";
import {
  applyReceiptControl,
  checkReceiptControlResult,
  invalidateReceiptEffects,
  ReceiptControlClientError,
  receiptControlMessage,
  useReceiptIdentity,
} from "@/lib/receipt-controls-client";
export function ReceiptCorrectionRecovery({
  request,
  onResult,
}: {
  request: ReceiptAutomationDTO;
  onResult?: (request: ReceiptAutomationDTO) => void;
}) {
  const identity = useReceiptIdentity(),
    current = useRef(identity),
    initial = useRef(identity);
  current.current = identity;
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const action = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "reservation-recovery", request.id],
    mutationFn: (kind: "apply" | "check") =>
      kind === "check"
        ? checkReceiptControlResult(request.id)
        : applyReceiptControl(request.id, request.version),
    onSuccess: (result) => {
      if (current.current !== initial.current) return;
      setMessage(
        result.outcome === "applied"
          ? "Deposit correction completed. N3 verified."
          : receiptControlMessage(result.code),
      );
      invalidateReceiptEffects(qc);
      onResult?.(result.request);
    },
    onError: (error) => {
      if (current.current !== initial.current) return;
      setMessage(
        receiptControlMessage(
          error instanceof ReceiptControlClientError ? error.code : "n3_update_unknown",
        ),
      );
      invalidateReceiptEffects(qc);
    },
    retry: false,
  });
  if (!request.automation || !identity || identity !== initial.current) return null;
  return (
    <div className="w-full space-y-2 rounded-md bg-slate-50 p-2 text-sm">
      <p role="status">
        {action.isPending
          ? "Checking saved correction…"
          : message ||
            request.outcomeMessage ||
            "Saved correction. Confirmed totals change only after N3 verification."}
      </p>
      {request.canCheckResult ? (
        <button
          type="button"
          disabled={action.isPending}
          className="rounded-md border bg-white px-3 py-2 font-medium"
          onClick={() => action.mutate("check")}
        >
          Check N3 result
        </button>
      ) : null}
      {request.canApply ? (
        <button
          type="button"
          disabled={action.isPending}
          className="rounded-md border bg-white px-3 py-2 font-medium"
          onClick={() => action.mutate("apply")}
        >
          Apply saved correction
        </button>
      ) : null}
    </div>
  );
}
