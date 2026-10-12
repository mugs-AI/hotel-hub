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

/** Recovery of old manual requests reuses the existing Owner-only GET verification
 * and audited rejection APIs. No upgrade or automatic financial dispatch. */
export function LegacyReceiptRecovery({ request }: { request: ReceiptAutomationDTO }) {
  const identity = useReceiptIdentity(),
    current = useRef(identity),
    initial = useRef(identity);
  current.current = identity;
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const action = useMutation({
    mutationKey: [
      "receipt-controls",
      identity ?? "none",
      "legacy-reservation-recovery",
      request.id,
    ],
    mutationFn: async (kind: "check" | "close") => {
      const { verifyReceiptControl, decideReceiptControl } =
        await import("@/lib/receipt-controls-client");
      return kind === "check"
        ? verifyReceiptControl(request.id, request.version)
        : decideReceiptControl(request.id, {
            expectedVersion: request.version,
            decision: "reject",
            note: "Owner closed legacy manual request in reservation; no N3 update sent",
          });
    },
    onSuccess: (result) => {
      if (current.current !== initial.current) return;
      setConfirmed(false);
      setMessage(
        result.request.state === "rejected"
          ? "Old request closed. Edit receipt to review fresh N3 details and save a new correction."
          : "Saved N3 result checked. Review the request status below.",
      );
      invalidateReceiptEffects(qc);
    },
    onError: (error) => {
      if (current.current === initial.current)
        setMessage(
          receiptControlMessage(
            error instanceof ReceiptControlClientError ? error.code : "request_failed",
          ),
        );
    },
    retry: false,
  });
  if (request.automation || !identity?.endsWith(":owner") || identity !== initial.current)
    return null;
  return (
    <div className="w-full space-y-2 rounded-md bg-slate-50 p-2 text-sm">
      <p role="status">
        {message ||
          "An old manual request locks this receipt. Check its saved N3 result here; this does not send an Update."}
      </p>
      {request.canVerify ? (
        <button
          type="button"
          disabled={action.isPending}
          className="rounded-md border bg-white px-3 py-2"
          onClick={() => action.mutate("check")}
        >
          Check old request result
        </button>
      ) : null}
      {request.canReject ? (
        confirmed ? (
          <div>
            <p>
              Close only this old HH request? Its history and N3 receipt are retained. This does not
              change money.
            </p>
            <button
              type="button"
              disabled={action.isPending}
              onClick={() => action.mutate("close")}
            >
              Confirm close old request
            </button>
            <button type="button" disabled={action.isPending} onClick={() => setConfirmed(false)}>
              Keep request
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={action.isPending}
            className="rounded-md border bg-white px-3 py-2"
            onClick={() => setConfirmed(true)}
          >
            Close old request
          </button>
        )
      ) : null}
    </div>
  );
}
