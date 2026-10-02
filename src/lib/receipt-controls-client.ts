// Browser-safe client for receipt-control endpoints (same-origin only).
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReceiptControlRequestDTO } from "./receipt-controls";
import { useSessionMe } from "./session-client";

export const RECEIPT_CONTROL_ERROR_MESSAGES: Record<string, string> = {
  journal_unproven:
    "N3 could not prove this receipt's journal exactly matches it. The request was not created.",
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

/** Query prefixes holding receipt/finance data that must never cross identities. */
export const SENSITIVE_RECEIPT_PREFIXES = ["receipt-controls", "financial-reporting"] as const;

type PurgeableClient = {
  removeQueries: (f: {
    queryKey: readonly unknown[];
    predicate: (q: { queryKey: readonly unknown[] }) => boolean;
  }) => unknown;
  getMutationCache?: () => {
    getAll: () => Array<{ options: { mutationKey?: readonly unknown[] } }>;
    remove: (m: never) => void;
  };
};

/**
 * Central auth-transition purge: removes every receipt/finance query and
 * receipt mutation result cached for any identity other than `identity`
 * (null = signed out / unknown => remove all). Runs from AppShell, so it
 * applies even when the Owner dashboard is not mounted.
 */
export function purgeSensitiveReceiptData(qc: PurgeableClient, identity: string | null) {
  for (const prefix of SENSITIVE_RECEIPT_PREFIXES)
    qc.removeQueries({
      queryKey: [prefix],
      predicate: (q) => identity === null || q.queryKey[1] !== identity,
    });
  const mc = qc.getMutationCache?.();
  if (!mc) return;
  for (const m of mc.getAll()) {
    const k = m.options.mutationKey;
    if (
      k &&
      SENSITIVE_RECEIPT_PREFIXES.includes(k[0] as never) &&
      (identity === null || k[1] !== identity)
    )
      mc.remove(m as never);
  }
}

/** Identity for receipt cache keys. A failed session read is NOT the old identity. */
export function identityFromSession(me: {
  isError?: boolean;
  data?: Parameters<typeof receiptIdentityKey>[0];
}): string | null {
  return me.isError ? null : receiptIdentityKey(me.data);
}

export function useReceiptIdentity(): string | null {
  return identityFromSession(useSessionMe());
}

/** Mounted once in AppShell: purge on every identity change, including sign-out. */
export function useSensitiveReceiptCacheGuard(): string | null {
  const qc = useQueryClient();
  const identity = useReceiptIdentity();
  useEffect(() => {
    purgeSensitiveReceiptData(qc, identity);
  }, [qc, identity]);
  return identity;
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
  /** Journal proof gate; reasons are safe codes, Owner-only (empty otherwise). */
  journal?: { exact: boolean; reasons: string[] };
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

/** Plain-language explanation for one safe journal reason code. */
export function journalReasonLabel(code: string): string {
  const m: Record<string, string> = {
    journal_envelope_unreadable: "N3 journal reply was not a readable success reply",
    journal_rows_missing: "N3 journal reply had no journal lines list",
    journal_rows_empty: "N3 journal reply had no lines",
    journal_forms_conflict: "N3 journal reply had two conflicting line lists",
    journal_row_not_object: "a journal line was not readable",
    journal_account_id_conflict: "a journal line named two different accounts",
    journal_account_code_conflict: "a journal line had two different account codes",
    journal_amount_conflict: "a journal line had two different amounts",
    journal_amount_unreadable: "a journal amount was not readable",
    journal_amount_negative: "a journal amount was negative",
    journal_row_both_sides: "a journal line had both debit and credit",
    journal_row_zero: "a journal line had no amount",
    journal_debit_account_id_missing: "the bank/cash line had no account",
    journal_credit_account_code_missing: "the customer line had no account code",
    journal_credit_code_conflict: "the customer lines had different codes",
    journal_debit_count_mismatch: "bank/cash lines differ from the receipt",
    journal_debit_account_mismatch: "bank/cash account differs from the receipt",
    journal_debit_amount_mismatch: "bank/cash amount differs from the receipt",
    journal_credit_count_mismatch: "expected exactly one customer line",
    journal_credit_is_payment_account: "the credit posts to a payment account",
    journal_credit_amount_mismatch: "customer amount differs from the receipt",
    journal_customer_code_not_saved: "HotelHub has no saved customer code for this deposit",
    journal_credit_customer_mismatch: "customer line posts to a different customer",
    journal_row_doc_code_missing: "journal lines do not show the receipt number",
    journal_row_doc_code_mismatch: "journal lines show a different receipt number",
    journal_row_reference_missing: "journal lines do not show the HotelHub reference",
    journal_row_reference_mismatch: "journal lines show a different reference",
    journal_unreadable: "the journal could not be read",
  };
  return m[code] ?? "unrecognised check";
}

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
