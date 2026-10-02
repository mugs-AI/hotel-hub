// Browser-safe client for receipt-control endpoints (same-origin only).
import type { ReceiptControlRequestDTO } from "./receipt-controls";

export const RECEIPT_CONTROL_ERROR_MESSAGES: Record<string, string> = {
  journal_unproven:
    "N3 could not prove this receipt's journal exactly matches it. The request was not created.",
  n3_evidence_unavailable: "N3 could not confirm the receipt right now. Nothing was changed.",
  receipt_control_list_incomplete: "Too many requests to load. Open the Owner queue.",
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
      accountId?: string;
      /** Omit to preserve the saved N3 contact exactly. */
      contact?: {
        name?: string;
        company?: string;
        address?: string;
        phone?: string;
        email?: string;
      };
    };

export const receiptControlsKey = (identityKey: string, scope: string) =>
  ["receipt-controls", identityKey, scope] as const;

/** Cache namespace for receipt data: authenticated tenant + user + role. */
export function receiptIdentityKey(
  me:
    | {
        authenticated: boolean;
        tenant?: { tenantId: string };
        user?: { n3UserKey: string };
        role?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!me || !me.authenticated || !me.tenant || !me.user || !me.role) return null;
  return `${me.tenant.tenantId}:${me.user.n3UserKey}:${me.role}`;
}

/**
 * Every query whose numbers come from the effective receipt projection. A
 * verified receipt change must refresh all of them so a mounted checkout,
 * reservation list, departures board or monthly report recalculates at once.
 */
export const RECEIPT_EFFECT_QUERY_PREFIXES = [
  "receipt-controls",
  "deposits",
  "folio",
  "reservations",
  "departures",
  "checkout-preview",
  "financial-reporting",
] as const;

export function invalidateReceiptEffects(qc: {
  invalidateQueries: (f: { queryKey: readonly unknown[] }) => unknown;
}) {
  for (const k of RECEIPT_EFFECT_QUERY_PREFIXES) void qc.invalidateQueries({ queryKey: [k] });
}

/** Drop receipt-control data cached for any other identity (auth switch). */
export function purgeForeignReceiptCache(
  qc: {
    removeQueries: (f: {
      queryKey: readonly unknown[];
      predicate: (q: { queryKey: readonly unknown[] }) => boolean;
    }) => unknown;
  },
  identityKey: string | null,
) {
  qc.removeQueries({
    queryKey: ["receipt-controls"],
    predicate: (q) => q.queryKey[1] !== identityKey,
  });
}

export type ReceiptOriginalDTO = {
  amountCents: number;
  currency: string;
  accountId: string | null;
  accountLabel: string | null;
  contact: {
    customerName: string;
    remark1: string;
    remark2: string;
    remark3: string;
    remark4: string;
  };
};

export function getReceiptOriginal(reservationId: string, depositId: string) {
  return call<{ original: ReceiptOriginalDTO }>(
    `/api/hotel/reservations/${encodeURIComponent(reservationId)}/deposits/${encodeURIComponent(depositId)}/receipt-requests`,
  );
}

export type ReceiptControlPageDTO = {
  requests: ReceiptControlRequestDTO[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  transport: { configured: boolean };
};

export function listReceiptControls(opts: {
  reservationId?: string;
  queue?: boolean;
  offset?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (opts.reservationId) q.set("reservationId", opts.reservationId);
  if (opts.queue) q.set("queue", "1");
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.limit) q.set("limit", String(opts.limit));
  return call<ReceiptControlPageDTO>(`/api/hotel/receipt-controls?${q}`);
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

export function recoverReceiptControl(requestId: string, expectedVersion: number) {
  return call<{ request: ReceiptControlRequestDTO }>(
    `/api/hotel/receipt-controls/${encodeURIComponent(requestId)}/recover`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
}

/**
 * Reads every page for a narrow scope (one reservation). Bounded: stops with an
 * error instead of returning a partial list when the page budget is exhausted.
 */
export async function listAllReceiptControls(
  opts: { reservationId: string },
  fetchPage: typeof listReceiptControls = listReceiptControls,
  maxPages = 20,
): Promise<ReceiptControlPageDTO> {
  let offset = 0;
  const requests: ReceiptControlRequestDTO[] = [];
  let last: ReceiptControlPageDTO | null = null;
  for (let i = 0; i < maxPages; i++) {
    last = await fetchPage({ ...opts, offset, limit: 100 });
    requests.push(...last.requests);
    if (last.nextOffset === null) return { ...last, requests, offset: 0, nextOffset: null };
    offset = last.nextOffset;
  }
  throw new ReceiptControlClientError("receipt_control_list_incomplete");
}
