// Browser-safe client for receipt-control endpoints (same-origin only).
import type { ReceiptControlRequestDTO } from "./receipt-controls";

export const RECEIPT_CONTROL_ERROR_MESSAGES: Record<string, string> = {
  invalid_reason: "Enter a reason (up to 500 characters).",
  invalid_amount: "Enter a valid amount.",
  invalid_account: "Choose a deposit account.",
  account_not_allowed: "That deposit account is not available.",
  proposal_unchanged: "Nothing was changed.",
  receipt_restricted:
    "This receipt is matched, refunded or cancelled in N3 and cannot be changed here.",
  receipt_control_active_exists: "This receipt already has an open request.",
  receipt_control_key_conflict:
    "This request was already sent with different details. Reopen the dialog.",
  version_conflict: "Someone else updated this request. Refresh and try again.",
  claim_conflict: "A verification is already running. Refresh in a moment.",
  invalid_transition: "This request can no longer be changed.",
  split_correction_unsupported: "Split-payment receipts must be corrected directly in N3.",
  receipt_contact_too_long: "A contact line is longer than 100 characters. Shorten it.",
  receipt_controls_unavailable: "Receipt corrections are not switched on yet.",
  n3_evidence_unavailable: "N3 could not be reached. Try again.",
  forbidden: "You do not have permission for this.",
  unauthorized: "Your N3 session expired. Relaunch HotelHub from N3.",
};

export const receiptControlMessage = (code: string) =>
  RECEIPT_CONTROL_ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";

export class ReceiptControlClientError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ReceiptControlClientError(String(body.error ?? "request_failed"));
  return body as T;
}

export type ReceiptControlProposalInput =
  | { kind: "void" }
  | {
      kind: "correction";
      amount: number;
      accountId: string;
      contact: {
        name?: string;
        company?: string;
        address?: string;
        phone?: string;
        email?: string;
      };
    };

export const receiptControlsKey = (tenantKey: string, scope: string) =>
  ["receipt-controls", tenantKey, scope] as const;

export function listReceiptControls(opts: { reservationId?: string; queue?: boolean }) {
  const q = new URLSearchParams();
  if (opts.reservationId) q.set("reservationId", opts.reservationId);
  if (opts.queue) q.set("queue", "1");
  return call<{ requests: ReceiptControlRequestDTO[]; transport: { configured: boolean } }>(
    `/api/hotel/receipt-controls?${q}`,
  );
}

export function createReceiptControl(
  reservationId: string,
  depositId: string,
  body: { clientRequestId: string; reason: string; proposal: ReceiptControlProposalInput },
) {
  return call<{ request: ReceiptControlRequestDTO }>(
    `/api/hotel/reservations/${encodeURIComponent(reservationId)}/deposits/${encodeURIComponent(depositId)}/receipt-requests`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function decideReceiptControl(
  requestId: string,
  body: { decision: "approve" | "reject"; expectedVersion: number; note?: string },
) {
  return call<{ request: ReceiptControlRequestDTO }>(
    `/api/hotel/receipt-controls/${encodeURIComponent(requestId)}/decision`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function verifyReceiptControl(requestId: string, expectedVersion: number) {
  return call<{ request: ReceiptControlRequestDTO }>(
    `/api/hotel/receipt-controls/${encodeURIComponent(requestId)}/verify`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
}
