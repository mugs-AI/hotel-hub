/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only reservation deposit ledger + the single controlled N3
// "AR Receive Payment" (AROR) write path.
//
// Invariants:
// - Tenant id, N3 token, actor key and role come from the HttpOnly session only.
// - The browser may supply `amount` and `clientRequestId` and nothing else.
// - Exactly one N3 create call per idempotency key, enforced by a unique
//   database claim taken BEFORE the outbound POST.
// - Ambiguous outcomes become `unknown` and are never auto-retried.

import { todayInKualaLumpurIso } from "./malaysia-date";
import { getOrCreateHotelSettings } from "./hotel-store.server";
import { logAudit } from "./audit.server";
import {
  isRealN3Id,
  isSafeReferenceNo,
  n3Receipts,
  type N3Outcome,
  type N3ReceiptsClient,
} from "./n3-receipts.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

// ---------------------------------------------------------------- feature gate

/**
 * Deployment-controlled, server-only. BOTH conditions must hold:
 *  - HOTELHUB_N3_DEPOSIT_WRITES_ENABLED === "true"
 *  - the immutable N3 tenant key is listed in HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST
 * Empty / missing values deny every tenant. Never exposed to the browser
 * beyond a single boolean capability flag.
 */
export function isDepositWriteEnabled(
  n3TenantKey: string | null | undefined,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  if (env.HOTELHUB_N3_DEPOSIT_WRITES_ENABLED !== "true") return false;
  const key = typeof n3TenantKey === "string" ? n3TenantKey.trim() : "";
  if (!key) return false;
  const raw = env.HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST;
  if (typeof raw !== "string" || !raw.trim()) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(key);
}

// ---------------------------------------------------------------- validation

export const DEPOSIT_ERROR_CODES = new Set([
  "invalid_amount",
  "invalid_client_request_id",
  "deposit_writes_disabled",
  "reservation_not_found",
  "reservation_not_eligible",
  "walk_in_customer_not_mapped",
  "n3_defaults_unavailable",
  "n3_defaults_invalid",
  "n3_preflight_unavailable",
  "n3_rejected",
  "n3_result_uncertain",
  "reference_conflict",
  "deposit_not_found",
  "deposit_not_uncertain",
  "deposit_not_recoverable",
  "deposit_claim_failed",
  "deposit_write_failed",
  "unauthorized",
]);


export class DepositError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DepositError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export const MAX_DEPOSIT_AMOUNT = 1_000_000;

/** Positive, finite, at most 2 decimals, bounded. Returns cents-rounded value. */
export function normalizeAmount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0 || v > MAX_DEPOSIT_AMOUNT) return null;
  const cents = Math.round(v * 100);
  if (Math.abs(v * 100 - cents) > 1e-6) return null; // more than 2 decimals
  return cents / 100;
}

/**
 * Deterministic, tenant-collision-resistant reference derived from the claimed
 * local deposit id. 27 chars, always <= the 30-char budget.
 */
export function buildReferenceNo(depositId: string): string {
  const hex = depositId.replace(/-/g, "").toLowerCase();
  if (hex.length < 24) throw new Error("buildReferenceNo: bad deposit id");
  return `HH-${hex.slice(0, 24)}`;
}

export function buildDepositDescription(bookingReference: string): string {
  const safe = String(bookingReference ?? "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 40);
  return `HOTELHUB DEPOSIT ${safe}`.slice(0, 100);
}

// ---------------------------------------------------------------- N3 parsing

function unwrap(body: unknown): any {
  if (!body || typeof body !== "object") return null;
  const b = body as any;
  if (b.data && typeof b.data === "object") {
    if (b.data.value && typeof b.data.value === "object") return b.data.value;
    return b.data;
  }
  if (b.value && typeof b.value === "object" && !Array.isArray(b.value)) return b.value;
  return b;
}

function rows(body: unknown): any[] {
  if (!body || typeof body !== "object") return [];
  const b = body as any;
  const candidates = [b?.data?.value, b?.data, b?.value, b];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

function pick(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    const lower = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
    if (lower && obj[lower] !== undefined && obj[lower] !== null && obj[lower] !== "") {
      return obj[lower];
    }
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export type N3ReceiptDefaults = {
  docType: string;
  currencyId: string;
  currencyRate: number;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  detailTemplate: Record<string, unknown> | null;
};

/**
 * Validate `GET /api/ARReceipts/New`. Fails closed unless the tenant-specific
 * currency and default payment account can be proven.
 */
export function parseNewReceiptDefaults(outcome: N3Outcome): N3ReceiptDefaults | null {
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return null;
  const v = unwrap(outcome.body);
  if (!v || typeof v !== "object") return null;
  const docType = str(pick(v, ["docType", "DocType"]));
  if (docType !== "AROR") return null;
  const currencyId = str(pick(v, ["currencyId", "CurrencyId"]));
  const currencyRate = num(pick(v, ["currencyRate", "CurrencyRate"]));
  const accountId = str(pick(v, ["accountId", "AccountId"]));
  if (!currencyId || !accountId) return null;
  if (currencyRate === null || currencyRate <= 0) return null;
  const accountObj = pick(v, ["account", "Account"]);
  const details = pick(v, ["details", "Details"]);
  const detailTemplate =
    Array.isArray(details) && details.length > 0 && typeof details[0] === "object"
      ? (details[0] as Record<string, unknown>)
      : null;
  return {
    docType,
    currencyId,
    currencyRate,
    accountId,
    accountCode: str(pick(v, ["accountCode", "AccountCode"])) ?? str(pick(accountObj, ["code"])),
    accountName: str(pick(v, ["accountName", "AccountName"])) ?? str(pick(accountObj, ["name"])),
    detailTemplate,
  };
}

export type DepositPayloadInput = {
  defaults: N3ReceiptDefaults;
  customerId: string;
  amount: number;
  referenceNo: string;
  description: string;
  docDate: string;
};

/**
 * Minimal official-schema ARReceiptDto. Everything comes from `/New` defaults,
 * the tenant walk-in mapping, or server generation. HotelHub NEVER supplies an
 * OR document number and never knocks off an invoice (unapplied deposit).
 */
export function buildDepositPayload(input: DepositPayloadInput): Record<string, unknown> {
  const { defaults, customerId, amount, referenceNo, description, docDate } = input;
  const detail: Record<string, unknown> = {
    ...(defaults.detailTemplate ?? {}),
    customerId,
    accountId: defaults.accountId,
    currencyId: defaults.currencyId,
    currencyRate: defaults.currencyRate,
    paymentAmount: amount,
    amount,
    referenceNo,
    description,
  };
  return {
    docType: "AROR",
    docDate,
    customerId,
    currencyId: defaults.currencyId,
    currencyRate: defaults.currencyRate,
    accountId: defaults.accountId,
    isMultiPayment: false,
    referenceNo,
    description,
    details: [detail],
    knockoff: [],
  };
}

export type ReceiptIdentity = { n3ReceiptId: string; n3DocCode: string };

export type CreateOutcomeVerdict =
  | { verdict: "posted"; identity: ReceiptIdentity }
  | { verdict: "failed"; code: string }
  | { verdict: "unknown"; code: string };

function envelopeRejected(body: unknown): boolean {
  const b: any = body;
  if (!b || typeof b !== "object") return false;
  if (b.success === false || b.isSuccess === false) return true;
  return false;
}

/**
 * A create is only `posted` with hard identity evidence that does not
 * contradict the request. Everything ambiguous becomes `unknown`.
 */
export function classifyCreateOutcome(
  outcome: N3Outcome,
  expected: { customerId: string; referenceNo: string; amount: number },
): CreateOutcomeVerdict {
  if (outcome.kind === "transport_error") {
    return { verdict: "unknown", code: `n3_${outcome.reason}` };
  }
  const { status, body } = outcome;
  if (status === 401) return { verdict: "unknown", code: "n3_unauthorized" };
  if (status >= 500) return { verdict: "unknown", code: "n3_server_error" };
  if (status === 400 || status === 409 || status === 422) {
    // Definite business/validation rejection: no document was created.
    return { verdict: "failed", code: "n3_rejected" };
  }
  if (status < 200 || status >= 300) return { verdict: "unknown", code: "n3_unexpected_status" };
  if (envelopeRejected(body)) return { verdict: "failed", code: "n3_rejected" };
  const v = unwrap(body);
  if (!v || typeof v !== "object") return { verdict: "unknown", code: "n3_malformed_success" };
  const id = str(pick(v, ["id", "Id", "receiptId"]));
  const docCode = str(pick(v, ["docCode", "DocCode", "docNo", "DocNo"]));
  if (!isRealN3Id(id) || !docCode) {
    return { verdict: "unknown", code: "n3_missing_identity" };
  }
  const docType = str(pick(v, ["docType", "DocType"]));
  if (docType && docType !== "AROR") return { verdict: "unknown", code: "n3_doctype_mismatch" };
  const cust = str(pick(v, ["customerId", "CustomerId"]));
  if (cust && cust !== expected.customerId) {
    return { verdict: "unknown", code: "n3_customer_mismatch" };
  }
  const ref = str(pick(v, ["referenceNo", "ReferenceNo"]));
  if (ref && ref !== expected.referenceNo) {
    return { verdict: "unknown", code: "n3_reference_mismatch" };
  }
  const total = num(pick(v, ["netTotalAmount", "totalAmount", "amount", "paymentAmount"]));
  if (total !== null && Math.abs(total - expected.amount) > 0.005) {
    return { verdict: "unknown", code: "n3_amount_mismatch" };
  }
  return { verdict: "posted", identity: { n3ReceiptId: id as string, n3DocCode: docCode } };
}

/**
 * Read-only exact-reference match used for pre-flight reconciliation and for
 * the Owner-triggered "Check N3 Result" action. Returns identity ONLY when a
 * structurally valid AROR for the same customer, currency and amount is found.
 */
export function matchExistingReceipt(
  outcome: N3Outcome,
  expected: {
    customerId: string;
    referenceNo: string;
    amount: number;
    currencyId: string | null;
  },
): { match: ReceiptIdentity } | { conflict: true } | null {
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return null;
  const list = rows(outcome.body);
  const sameRef = list.filter(
    (r) => str(pick(r, ["referenceNo", "ReferenceNo"])) === expected.referenceNo,
  );
  if (sameRef.length === 0) return null;
  for (const r of sameRef) {
    const docType = str(pick(r, ["docType", "DocType"]));
    if (docType !== "AROR") return { conflict: true };
    const id = str(pick(r, ["id", "Id"]));
    const docCode = str(pick(r, ["docCode", "DocCode", "docNo", "DocNo"]));
    if (!isRealN3Id(id) || !docCode) return { conflict: true };
    const custObj = pick(r, ["customer", "Customer"]);
    const cust = str(pick(r, ["customerId", "CustomerId"])) ?? str(pick(custObj, ["id"]));
    if (cust && cust !== expected.customerId) return { conflict: true };
    const currency =
      str(pick(r, ["currencyId", "CurrencyId"])) ??
      str(pick(pick(r, ["currency", "Currency"]), ["id"]));
    if (expected.currencyId && currency && currency !== expected.currencyId) {
      return { conflict: true };
    }
    const total = num(pick(r, ["netTotalAmount", "totalAmount", "amount", "paymentAmount"]));
    if (total === null || Math.abs(total - expected.amount) > 0.005) return { conflict: true };
    return { match: { n3ReceiptId: id as string, n3DocCode: docCode } };
  }
  return null;
}

// ---------------------------------------------------------------- persistence

export type DepositRecord = {
  id: string;
  reservationId: string;
  amount: number;
  currencyCode: string;
  status: "submitting" | "posted" | "failed" | "unknown";
  n3ReferenceNo: string;
  n3ReceiptId: string | null;
  n3DocCode: string | null;
  n3CustomerCode: string | null;
  n3CustomerName: string | null;
  n3AccountCode: string | null;
  n3AccountName: string | null;
  description: string | null;
  createdByN3UserKey: string;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

function toRecord(row: any): DepositRecord {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    amount: Number(row.amount),
    currencyCode: row.currency_code,
    status: row.status,
    n3ReferenceNo: row.n3_reference_no,
    n3ReceiptId: row.n3_receipt_id ?? null,
    n3DocCode: row.n3_doc_code ?? null,
    n3CustomerCode: row.n3_customer_code ?? null,
    n3CustomerName: row.n3_customer_name ?? null,
    n3AccountCode: row.n3_account_code ?? null,
    n3AccountName: row.n3_account_name ?? null,
    description: row.description ?? null,
    createdByN3UserKey: row.created_by_n3_user_key,
    lastErrorCode: row.last_error_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "id, reservation_id, amount, currency_code, status, n3_reference_no, n3_receipt_id, n3_doc_code, n3_customer_code, n3_customer_name, n3_account_code, n3_account_name, description, created_by_n3_user_key, last_error_code, created_at, updated_at";

export async function listDeposits(
  tenantId: string,
  reservationId: string,
): Promise<DepositRecord[]> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_deposits")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: false });
  if (res.error) throw new DepositError("deposit_write_failed");
  return (res.data ?? []).map(toRecord);
}

export async function getDeposit(
  tenantId: string,
  reservationId: string,
  depositId: string,
): Promise<DepositRecord | null> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_deposits")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .eq("id", depositId)
    .maybeSingle();
  if (res.error) throw new DepositError("deposit_write_failed");
  return res.data ? toRecord(res.data) : null;
}

async function findByIdempotencyKey(
  tenantId: string,
  key: string,
): Promise<DepositRecord | null> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_deposits")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (res.error) throw new DepositError("deposit_write_failed");
  return res.data ? toRecord(res.data) : null;
}

async function updateDeposit(tenantId: string, id: string, patch: Record<string, unknown>) {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_deposits")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(SELECT_COLS)
    .maybeSingle();
  if (res.error || !res.data) throw new DepositError("deposit_write_failed");
  return toRecord(res.data);
}

// ---------------------------------------------------------------- orchestration

export type CreateDepositInput = {
  tenantId: string;
  n3TenantKey: string;
  reservationId: string;
  actorN3UserKey: string;
  n3Token: string;
  amount: number;
  clientRequestId: string;
};

export type DepositDeps = {
  n3?: N3ReceiptsClient;
  env?: Record<string, string | undefined>;
};

async function loadEligibleReservation(tenantId: string, reservationId: string) {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservations")
    .select("id, booking_reference, status, currency")
    .eq("tenant_id", tenantId)
    .eq("id", reservationId)
    .maybeSingle();
  if (res.error) throw new DepositError("deposit_write_failed");
  if (!res.data) throw new DepositError("reservation_not_found");
  if (res.data.status !== "confirmed") throw new DepositError("reservation_not_eligible");
  return res.data as { id: string; booking_reference: string; status: string; currency: string };
}

export async function createDeposit(
  input: CreateDepositInput,
  deps: DepositDeps = {},
): Promise<{ deposit: DepositRecord; reused: boolean }> {
  const n3 = deps.n3 ?? n3Receipts;
  const env = deps.env;

  if (!isDepositWriteEnabled(input.n3TenantKey, env ?? (process.env as any))) {
    throw new DepositError("deposit_writes_disabled");
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) throw new DepositError("invalid_amount");
  if (!isUuidLike(input.clientRequestId)) throw new DepositError("invalid_client_request_id");
  if (!isUuidLike(input.reservationId)) throw new DepositError("reservation_not_found");

  // A repeat of the same client request returns the existing result and
  // never issues a second N3 create call.
  const existing = await findByIdempotencyKey(input.tenantId, input.clientRequestId);
  if (existing) return { deposit: existing, reused: true };

  const reservation = await loadEligibleReservation(input.tenantId, input.reservationId);
  const settings = await getOrCreateHotelSettings(input.tenantId);
  if (!settings.walkInCustomer?.n3Id || !settings.walkInCustomer?.n3Code) {
    throw new DepositError("walk_in_customer_not_mapped");
  }

  const defaultsOutcome = await n3.getNew(input.n3Token);
  if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401) {
    throw new DepositError("unauthorized");
  }
  const defaults = parseNewReceiptDefaults(defaultsOutcome);
  if (!defaults) {
    throw new DepositError(
      defaultsOutcome.kind === "transport_error"
        ? "n3_defaults_unavailable"
        : "n3_defaults_invalid",
    );
  }

  const description = buildDepositDescription(reservation.booking_reference);

  // Atomically claim the idempotency key BEFORE any outbound call.
  const sb = await admin();
  const claimId = crypto.randomUUID();
  const referenceNo = buildReferenceNo(claimId);
  if (!isSafeReferenceNo(referenceNo)) throw new DepositError("deposit_claim_failed");

  const claim = await sb
    .from("hotel_reservation_deposits")
    .insert({
      id: claimId,
      tenant_id: input.tenantId,
      reservation_id: input.reservationId,
      amount,
      currency_code: settings.currency,
      idempotency_key: input.clientRequestId,
      n3_reference_no: referenceNo,
      status: "submitting",
      n3_customer_id: settings.walkInCustomer.n3Id,
      n3_customer_code: settings.walkInCustomer.n3Code,
      n3_customer_name: settings.walkInCustomer.n3Name,
      n3_account_id: defaults.accountId,
      n3_account_code: defaults.accountCode,
      n3_account_name: defaults.accountName,
      description,
      created_by_n3_user_key: input.actorN3UserKey,
    })
    .select(SELECT_COLS)
    .maybeSingle();

  if (claim.error || !claim.data) {
    // Lost the race with a concurrent duplicate: return that row, no POST.
    const raced = await findByIdempotencyKey(input.tenantId, input.clientRequestId);
    if (raced) return { deposit: raced, reused: true };
    throw new DepositError("deposit_claim_failed");
  }
  let deposit = toRecord(claim.data);

  await logAudit({
    tenantId: input.tenantId,
    n3UserKey: input.actorN3UserKey,
    eventType: "hotel.deposit.create_requested",
    detail: {
      depositId: deposit.id,
      reservationId: input.reservationId,
      bookingReference: reservation.booking_reference,
      amount,
      currency: deposit.currencyCode,
      referenceNo,
    },
  });

  const expected = {
    customerId: settings.walkInCustomer.n3Id,
    referenceNo,
    amount,
    currencyId: defaults.currencyId,
  };

  // Pre-flight read-only reconciliation: never POST twice for one reference.
  const pre = await n3.listByReference(input.n3Token, referenceNo);
  const preMatch = matchExistingReceipt(pre, expected);
  if (preMatch && "conflict" in preMatch) {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "failed",
      last_error_code: "reference_conflict",
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.failed",
      detail: { depositId: deposit.id, reservationId: input.reservationId, code: "reference_conflict" },
    });
    return { deposit, reused: false };
  }
  if (preMatch && "match" in preMatch) {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "posted",
      n3_receipt_id: preMatch.match.n3ReceiptId,
      n3_doc_code: preMatch.match.n3DocCode,
      last_error_code: null,
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.reconciled",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        n3ReceiptId: preMatch.match.n3ReceiptId,
        n3DocCode: preMatch.match.n3DocCode,
        via: "preflight",
      },
    });
    return { deposit, reused: false };
  }

  const payload = buildDepositPayload({
    defaults,
    customerId: settings.walkInCustomer.n3Id,
    amount,
    referenceNo,
    description,
    docDate: todayInKualaLumpurIso(),
  });

  const created = await n3.create(input.n3Token, payload);
  const verdict = classifyCreateOutcome(created, expected);

  if (verdict.verdict === "posted") {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "posted",
      n3_receipt_id: verdict.identity.n3ReceiptId,
      n3_doc_code: verdict.identity.n3DocCode,
      last_error_code: null,
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.posted",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        amount,
        currency: deposit.currencyCode,
        n3ReceiptId: verdict.identity.n3ReceiptId,
        n3DocCode: verdict.identity.n3DocCode,
      },
    });
    return { deposit, reused: false };
  }

  if (verdict.verdict === "failed") {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "failed",
      last_error_code: verdict.code,
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.failed",
      detail: { depositId: deposit.id, reservationId: input.reservationId, code: verdict.code },
    });
    return { deposit, reused: false };
  }

  deposit = await updateDeposit(input.tenantId, deposit.id, {
    status: "unknown",
    last_error_code: verdict.code,
  });
  await logAudit({
    tenantId: input.tenantId,
    n3UserKey: input.actorN3UserKey,
    eventType: "hotel.deposit.unknown",
    detail: { depositId: deposit.id, reservationId: input.reservationId, code: verdict.code },
  });
  return { deposit, reused: false };
}

/**
 * Owner-triggered "Check N3 Result". GET-only against N3: it can move an
 * `unknown` row to `posted`, and can never create a document.
 */
export async function reconcileDeposit(
  input: {
    tenantId: string;
    n3TenantKey: string;
    reservationId: string;
    depositId: string;
    actorN3UserKey: string;
    n3Token: string;
  },
  deps: DepositDeps = {},
): Promise<DepositRecord> {
  const n3 = deps.n3 ?? n3Receipts;
  const deposit = await getDeposit(input.tenantId, input.reservationId, input.depositId);
  if (!deposit) throw new DepositError("deposit_not_found");
  if (deposit.status !== "unknown") throw new DepositError("deposit_not_uncertain");

  const sb = await admin();
  const snap = await sb
    .from("hotel_reservation_deposits")
    .select("n3_customer_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.depositId)
    .maybeSingle();
  const customerId = snap.data?.n3_customer_id ?? null;
  if (!customerId) throw new DepositError("walk_in_customer_not_mapped");

  const outcome = await n3.listByReference(input.n3Token, deposit.n3ReferenceNo);
  if (outcome.kind === "response" && outcome.status === 401) {
    throw new DepositError("unauthorized");
  }
  const match = matchExistingReceipt(outcome, {
    customerId,
    referenceNo: deposit.n3ReferenceNo,
    amount: deposit.amount,
    currencyId: null,
  });
  if (!match || "conflict" in match) {
    // Still uncertain. Never auto-retry the create.
    return deposit;
  }
  const updated = await updateDeposit(input.tenantId, deposit.id, {
    status: "posted",
    n3_receipt_id: match.match.n3ReceiptId,
    n3_doc_code: match.match.n3DocCode,
    last_error_code: null,
  });
  await logAudit({
    tenantId: input.tenantId,
    n3UserKey: input.actorN3UserKey,
    eventType: "hotel.deposit.reconciled",
    detail: {
      depositId: updated.id,
      reservationId: input.reservationId,
      n3ReceiptId: match.match.n3ReceiptId,
      n3DocCode: match.match.n3DocCode,
      via: "manual_check",
    },
  });
  return updated;
}

/** Sanitized browser-facing DTO. Never includes N3 internal customer/account ids. */
export function toDepositDTO(d: DepositRecord) {
  return {
    id: d.id,
    status: d.status,
    amount: d.amount,
    currency: d.currencyCode,
    n3DocCode: d.n3DocCode,
    n3ReceiptId: d.status === "posted" ? d.n3ReceiptId : null,
    customerLabel: d.n3CustomerName ?? d.n3CustomerCode,
    accountLabel:
      d.n3AccountCode && d.n3AccountName
        ? `${d.n3AccountCode} — ${d.n3AccountName}`
        : (d.n3AccountCode ?? d.n3AccountName),
    description: d.description,
    createdByN3UserKey: d.createdByN3UserKey,
    createdAt: d.createdAt,
    errorCode: d.lastErrorCode,
  };
}
