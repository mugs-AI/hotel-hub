/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only reservation deposit ledger + the single controlled N3
// "AR Receive Payment" (AROR) write path.
//
// Invariants:
// - Tenant id, N3 token, actor key and role come from the HttpOnly session only.
// - The browser supplies amount, immutable N3 payment account IDs and a client request ID.
// - Exactly one N3 create call per idempotency key, enforced by a unique
//   database claim taken BEFORE the outbound POST.
// - Ambiguous outcomes become `unknown` and are never auto-retried.

import { todayInKualaLumpurIso } from "./malaysia-date";
import { isDepositReservationEligible } from "./deposit-entry";
import { getOrCreateHotelSettings } from "./hotel-store.server";
import { logAudit } from "./audit.server";
import { readReceiptContact, type ReceiptContact } from "./receipt-contact.server";
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
  "receipt_contact_unavailable",
  "receipt_contact_too_long",
  "invalid_client_request_id",
  "invalid_payment_lines",
  "payment_method_hidden",
  "multi_payment_contract_unverified",
  "deposit_writes_disabled",
  "reservation_not_found",
  "reservation_not_eligible",
  "walk_in_customer_not_mapped",
  "n3_defaults_unavailable",
  "n3_defaults_invalid",
  "n3_defaults_rejected",
  "n3_defaults_type_invalid",
  "n3_defaults_currency_missing",
  "n3_defaults_currency_invalid",
  "n3_defaults_currency_code_missing",
  "n3_defaults_currency_conflict",
  "n3_defaults_rate_invalid",
  "n3_defaults_account_invalid",
  "n3_deposit_account_unavailable",
  "n3_deposit_account_invalid",
  "n3_preflight_unavailable",
  "n3_rejected",
  "n3_result_uncertain",
  "n3_receipt_readback_uncertain",
  "n3_journal_readback_uncertain",
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

function positiveInt(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function valuesFor(obj: unknown, keys: string[]): unknown[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const names = keys.map((key) => key.toLowerCase());
  return Object.entries(obj)
    .filter(([key, value]) => names.includes(key.toLowerCase()) && value !== undefined)
    .map(([, value]) => value);
}

function fieldsAgree(obj: unknown, keys: string[], check: (value: unknown) => boolean): boolean {
  return valuesFor(obj, keys).every(check);
}

/** Both /New consumers accept casing variants and reject ambiguous envelopes. */
function unwrapReceiptDefaults(body: unknown): any {
  const envelopes = valuesFor(body, ["data"]);
  if (envelopes.some((value) => JSON.stringify(value) !== JSON.stringify(envelopes[0])))
    return null;
  const envelope = envelopes.length ? envelopes[0] : body;
  const values = valuesFor(envelope, ["value"]);
  if (values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))) return null;
  const value = values.length ? values[0] : envelope;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** N3 OpenAPI JSON responses carry a business code even when HTTP is 200. */
function successfulEnvelope(body: unknown): boolean {
  return (
    valuesFor(body, ["code"]).length > 0 &&
    fieldsAgree(body, ["code"], (value) => value === "0000") &&
    fieldsAgree(
      body,
      ["success"],
      (value) => value === true || value === 1 || value === "true" || value === "1",
    )
  );
}

export type N3ReceiptDefaults = {
  docType: string;
  currencyId: string;
  currencyCode: string;
  currencyRate: number;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
};

/** Account lookup needs currency proof, not the defaults needed to POST a receipt. */
export function readPaymentAccountCurrency(
  outcome: N3Outcome,
): { ok: true; currencyId: string } | { ok: false; error: string } {
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300)
    return { ok: false, error: "n3_defaults_unavailable" };
  if (!successfulEnvelope(outcome.body)) return { ok: false, error: "n3_defaults_rejected" };
  const v = unwrapReceiptDefaults(outcome.body);
  if (!v) return { ok: false, error: "n3_defaults_invalid" };
  const rawId = pick(v, ["currencyId"]);
  if (rawId === undefined) return { ok: false, error: "n3_defaults_currency_missing" };
  const id = positiveInt(rawId);
  if (id === null) return { ok: false, error: "n3_defaults_currency_invalid" };
  const currencyId = String(id);
  const currencies = valuesFor(v, ["currency"]);
  const codes = [
    ...valuesFor(v, ["currencyCode"]),
    ...currencies.flatMap((currency) => valuesFor(currency, ["code"])),
  ];
  const code = str(codes[0])?.toUpperCase();
  if (
    !fieldsAgree(v, ["currencyId"], (value) => str(value) === currencyId) ||
    !currencies.every((currency) =>
      fieldsAgree(currency, ["id"], (value) => str(value) === currencyId),
    ) ||
    (codes.length > 0 && (!code || !codes.every((value) => str(value)?.toUpperCase() === code)))
  )
    return { ok: false, error: "n3_defaults_currency_conflict" };
  return { ok: true, currencyId };
}

/**
 * Verify tenant-specific receipt defaults without inventing financial values.
 * Preview/Create already require independently verified payment lines, so a
 * blank /New default account must not override or block the chosen account.
 */
export function readNewReceiptDefaults(
  outcome: N3Outcome,
  requireDefaultAccount = true,
): { ok: true; defaults: N3ReceiptDefaults } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300)
    return fail("n3_defaults_unavailable");
  if (!successfulEnvelope(outcome.body)) return fail("n3_defaults_rejected");
  const v = unwrapReceiptDefaults(outcome.body);
  if (!v) return fail("n3_defaults_invalid");
  const docType = str(pick(v, ["docType"]));
  if (docType !== "AROR" || !fieldsAgree(v, ["docType"], (value) => str(value) === "AROR"))
    return fail("n3_defaults_type_invalid");
  const rawCurrencyId = pick(v, ["currencyId"]);
  if (rawCurrencyId === undefined) return fail("n3_defaults_currency_missing");
  const currencyIdNumber = positiveInt(rawCurrencyId);
  if (currencyIdNumber === null) return fail("n3_defaults_currency_invalid");
  const currencyId = String(currencyIdNumber);
  const currency = pick(v, ["currency"]);
  const currencyCode = str(pick(v, ["currencyCode"])) ?? str(pick(currency, ["code"]));
  if (!currencyCode) return fail("n3_defaults_currency_code_missing");
  if (
    !fieldsAgree(v, ["currencyId"], (value) => str(value) === currencyId) ||
    !valuesFor(v, ["currency"]).every((obj) =>
      fieldsAgree(obj, ["id"], (value) => str(value) === currencyId),
    ) ||
    !fieldsAgree(
      v,
      ["currencyCode"],
      (value) => str(value)?.toUpperCase() === currencyCode.toUpperCase(),
    ) ||
    !valuesFor(v, ["currency"]).every((obj) =>
      fieldsAgree(
        obj,
        ["code"],
        (value) => str(value)?.toUpperCase() === currencyCode.toUpperCase(),
      ),
    )
  )
    return fail("n3_defaults_currency_conflict");
  const currencyRate = num(pick(v, ["currencyRate"]));
  if (
    currencyRate === null ||
    currencyRate <= 0 ||
    !fieldsAgree(v, ["currencyRate"], (value) => num(value) === currencyRate)
  )
    return fail("n3_defaults_rate_invalid");
  const suppliedAccountId = pick(v, ["accountId"]);
  const rawAccountId = str(suppliedAccountId);
  const accountId = isRealN3Id(rawAccountId) ? rawAccountId : null;
  const blankAccount = (value: unknown) =>
    value === undefined ||
    value === null ||
    (typeof value === "string" &&
      (!value.trim() || value.trim() === "00000000-0000-0000-0000-000000000000"));
  if (
    (requireDefaultAccount && !accountId) ||
    (!accountId && !blankAccount(suppliedAccountId)) ||
    !fieldsAgree(v, ["accountId"], (value) =>
      accountId ? str(value)?.toLowerCase() === accountId.toLowerCase() : blankAccount(value),
    )
  )
    return fail("n3_defaults_account_invalid");
  const accountObj = pick(v, ["account"]);
  return {
    ok: true,
    defaults: {
      docType,
      currencyId,
      currencyCode: currencyCode.toUpperCase(),
      currencyRate,
      accountId,
      accountCode: str(pick(v, ["accountCode"])) ?? str(pick(accountObj, ["code"])),
      accountName: str(pick(v, ["accountName"])) ?? str(pick(accountObj, ["name"])),
    },
  };
}

/** Strict compatibility parser for callers that need a default account. */
export function parseNewReceiptDefaults(outcome: N3Outcome): N3ReceiptDefaults | null {
  const result = readNewReceiptDefaults(outcome);
  return result.ok ? result.defaults : null;
}

function requireReceiptDefaults(outcome: N3Outcome): N3ReceiptDefaults {
  if (outcome.kind === "response" && outcome.status === 401) throw new DepositError("unauthorized");
  const result = readNewReceiptDefaults(outcome, false);
  if (!result.ok) throw new DepositError(result.error);
  return result.defaults;
}
export type VerifiedDepositAccount = {
  id: string;
  code: string;
  name: string;
  kind: "bank" | "cash";
};

/** Verify the selected default against this tenant's authoritative account DTO. */
export function parseDepositAccount(
  outcome: N3Outcome,
  expectedId: string,
  currencyId: string,
): VerifiedDepositAccount | null {
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return null;
  if (!successfulEnvelope(outcome.body)) return null;
  const v = unwrap(outcome.body);
  if (!v || typeof v !== "object") return null;
  const id = str(pick(v, ["id", "Id"]));
  const code = str(pick(v, ["code", "Code"]));
  const name = str(pick(v, ["name", "Name"]));
  const accountType = pick(v, ["accountType", "AccountType"]);
  const typeCode = str(pick(accountType, ["typeCode", "TypeCode"]));
  const specialCode = str(pick(v, ["specialCode", "SpecialCode"]));
  const isActive = pick(v, ["isActive", "IsActive"]);
  const hasChildren = pick(v, ["hasChildren", "HasChildren"]);
  const accountCurrencyId = positiveInt(pick(v, ["currencyId", "CurrencyId"]));
  if (!isRealN3Id(id) || id.toLowerCase() !== expectedId.toLowerCase()) return null;
  if (!code || !name || typeCode !== "BCA") return null;
  if (specialCode !== "BAC" && specialCode !== "CAC") return null;
  if (isActive !== true || hasChildren !== false) return null;
  if (accountCurrencyId !== positiveInt(currencyId)) return null;
  return { id, code, name, kind: specialCode === "BAC" ? "bank" : "cash" };
}

async function verifyDepositAccount(
  n3: N3ReceiptsClient,
  token: string,
  defaults: N3ReceiptDefaults,
  selectedId: string | null = defaults.accountId,
): Promise<VerifiedDepositAccount> {
  if (!isRealN3Id(selectedId)) throw new DepositError("invalid_payment_lines");
  const outcome = await n3.getAccountById(token, selectedId);
  if (outcome.kind === "response" && outcome.status === 401) {
    throw new DepositError("unauthorized");
  }
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) {
    throw new DepositError("n3_deposit_account_unavailable");
  }
  const account = parseDepositAccount(outcome, selectedId, defaults.currencyId);
  if (!account) throw new DepositError("n3_deposit_account_invalid");
  return account;
}

export type PaymentChoice = { accountId: string; amount: number };
export type VerifiedPaymentLine = VerifiedDepositAccount & { amount: number };

function requireShownPaymentMethods(
  choices: PaymentChoice[],
  visibility: Record<string, boolean> = {},
): void {
  if (choices.some((line) => visibility[line.accountId.toLowerCase()] === false))
    throw new DepositError("payment_method_hidden");
}

export function validatePaymentChoices(amount: number, choices: unknown): PaymentChoice[] {
  if (!Array.isArray(choices) || choices.length < 1 || choices.length > 10)
    throw new DepositError("invalid_payment_lines");
  const seen = new Set<string>();
  let cents = 0;
  const result: PaymentChoice[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice))
      throw new DepositError("invalid_payment_lines");
    const id = (choice as Record<string, unknown>).accountId;
    const value = normalizeAmount((choice as Record<string, unknown>).amount);
    if (!isRealN3Id(id) || value === null || seen.has(id.toLowerCase()))
      throw new DepositError("invalid_payment_lines");
    seen.add(id.toLowerCase());
    cents += Math.round(value * 100);
    result.push({ accountId: id, amount: value });
  }
  if (cents !== Math.round(amount * 100)) throw new DepositError("invalid_payment_lines");
  return result;
}

export async function verifyPaymentLines(
  n3: N3ReceiptsClient,
  token: string,
  defaults: N3ReceiptDefaults,
  amount: number,
  choices: unknown,
): Promise<VerifiedPaymentLine[]> {
  const valid = validatePaymentChoices(amount, choices);
  const verified: VerifiedPaymentLine[] = [];
  for (const line of valid)
    verified.push({
      ...(await verifyDepositAccount(n3, token, defaults, line.accountId)),
      amount: line.amount,
    });
  return verified;
}

/** Read-only account choices; final selection is independently verified by detail ID. */
export async function listEligiblePaymentAccounts(
  n3: N3ReceiptsClient,
  token: string,
  currencyId: string,
): Promise<VerifiedDepositAccount[]> {
  const result: VerifiedDepositAccount[] = [];
  for (let skip = 0; skip <= 900; skip += 100) {
    const outcome = await n3.listPaymentAccounts(token, skip);
    if (outcome.kind === "response" && outcome.status === 401)
      throw new DepositError("unauthorized");
    if (outcome.kind === "response" && outcome.status === 403)
      throw new DepositError("n3_account_access_denied");
    if (
      outcome.kind !== "response" ||
      outcome.status < 200 ||
      outcome.status >= 300 ||
      !successfulEnvelope(outcome.body)
    )
      throw new DepositError("n3_deposit_account_unavailable");
    // Accept the verified N3 Value casing while still requiring an array
    // inside a declared-success envelope.
    const data = (outcome.body as any)?.data ?? (outcome.body as any)?.Data;
    const pageRows = data?.value ?? data?.Value;
    if (!Array.isArray(pageRows)) throw new DepositError("n3_deposit_account_unavailable");
    const page = pageRows as unknown[];
    for (const row of page) {
      const id = str(pick(row, ["id"]));
      if (!isRealN3Id(id)) continue;
      const account = parseDepositAccount(
        { kind: "response", status: 200, body: { code: "0000", data: row }, durationMs: 0 },
        id,
        currencyId,
      );
      if (account) result.push(account);
    }
    if (page.length < 100) return result;
  }
  throw new DepositError("n3_deposit_account_unavailable");
}

export type DepositPayloadInput = {
  defaults: N3ReceiptDefaults;
  customerId: string;
  amount: number;
  referenceNo: string;
  description: string;
  docDate: string;
  paymentLines?: VerifiedPaymentLine[];
  contact?: ReceiptContact;
};

/**
 * Minimal official-schema ARReceiptDto. Everything comes from `/New` defaults,
 * the tenant walk-in mapping, or server generation. HotelHub NEVER supplies an
 * OR document number and never knocks off an invoice (unapplied deposit).
 */
export function buildDepositPayload(input: DepositPayloadInput): Record<string, unknown> {
  const { defaults, customerId, amount, referenceNo, description, docDate } = input;
  const customerNumber = positiveInt(customerId);
  const currencyNumber = positiveInt(defaults.currencyId);
  if (customerNumber === null || currencyNumber === null) {
    throw new DepositError("n3_defaults_invalid");
  }
  const lines = input.paymentLines;
  if (lines?.length)
    validatePaymentChoices(
      amount,
      lines.map((l) => ({ accountId: l.id, amount: l.amount })),
    );
  const multi = Boolean(lines && lines.length > 1);
  if (!multi && !isRealN3Id(lines?.[0]?.id ?? defaults.accountId))
    throw new DepositError("invalid_payment_lines");
  return {
    docType: "AROR",
    docDate,
    customerId: customerNumber,
    ...input.contact,
    currencyId: currencyNumber,
    currencyRate: defaults.currencyRate,
    ...(multi
      ? {
          isMultiPayment: true,
          multiPayments: lines!.map((l) => ({ accountId: l.id, amount: l.amount })),
        }
      : { accountId: lines?.[0]?.id ?? defaults.accountId }),
    totalAmount: amount,
    referenceNo,
    description,
    knockoff: [],
  };
}

export type ReceiptIdentity = { n3ReceiptId: string; n3DocCode: string };

export type CreateOutcomeVerdict =
  | { verdict: "posted"; identity: ReceiptIdentity }
  | { verdict: "failed"; code: string }
  | { verdict: "unknown"; code: string };

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
  // 403 is NOT a session-expiry signal. Fail closed as uncertain: the request
  // may or may not have been applied, but we never destroy the session for it.
  if (status === 403) return { verdict: "unknown", code: "n3_forbidden" };
  if (status >= 500) return { verdict: "unknown", code: "n3_server_error" };
  if (status === 400 || status === 409 || status === 422) {
    // Definite business/validation rejection: no document was created.
    return { verdict: "failed", code: "n3_rejected" };
  }
  if (status < 200 || status >= 300) return { verdict: "unknown", code: "n3_unexpected_status" };
  if (!successfulEnvelope(body)) {
    // A 2xx with a contradictory business code is not evidence that a
    // document was never created. Keep the claim for GET-only reconciliation.
    return { verdict: "unknown", code: "n3_business_result_uncertain" };
  }
  const v = unwrap(body);
  if (!v || typeof v !== "object") return { verdict: "unknown", code: "n3_malformed_success" };
  const id = str(pick(v, ["id", "Id", "receiptId"]));
  const docCode = str(pick(v, ["docCode", "DocCode", "docNo", "DocNo"]));
  if (!isRealN3Id(id) || !docCode) {
    return { verdict: "unknown", code: "n3_missing_identity" };
  }
  if (
    !fieldsAgree(
      v,
      ["id", "receiptId"],
      (value) => str(value)?.toLowerCase() === id.toLowerCase(),
    ) ||
    !fieldsAgree(v, ["docCode", "docNo"], (value) => str(value) === docCode) ||
    !fieldsAgree(v, ["docType"], (value) => value === "AROR") ||
    !fieldsAgree(v, ["customerId"], (value) => str(value) === expected.customerId) ||
    !fieldsAgree(v, ["referenceNo"], (value) => str(value) === expected.referenceNo) ||
    !fieldsAgree(
      v,
      ["totalAmount", "netTotalAmount", "amount", "paymentAmount"],
      (value) => moneyCents(value) === moneyCents(expected.amount),
    )
  )
    return { verdict: "unknown", code: "n3_business_result_uncertain" };
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

type ReceiptPostingExpectation = {
  identity: ReceiptIdentity;
  customerId: string;
  customerCode: string;
  referenceNo: string;
  amount: number;
  currencyId: string | null;
  currencyCode: string;
  paymentLines: VerifiedPaymentLine[];
};

type PostingReadback =
  | { kind: "verified" }
  | {
      kind: "unknown";
      code: "n3_receipt_readback_uncertain" | "n3_journal_readback_uncertain";
      unauthorized: boolean;
    };

function moneyCents(v: unknown): number | null {
  const n = num(v);
  if (n === null || n < 0 || n > MAX_DEPOSIT_AMOUNT) return null;
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 1e-6 ? cents : null;
}

function inactiveReceipt(receipt: unknown): boolean {
  if (
    valuesFor(receipt, ["status", "documentStatus"]).some((value) =>
      ["void", "voided", "cancelled", "canceled"].includes(str(value)?.toLowerCase() ?? ""),
    )
  )
    return true;
  return valuesFor(receipt, ["isCancelled", "isCanceled", "isVoid", "isVoided"]).some((value) => {
    if (value === null) return false;
    return (
      value !== undefined &&
      value !== false &&
      value !== 0 &&
      !(typeof value === "string" && ["false", "0", "no", "n"].includes(value.trim().toLowerCase()))
    );
  });
}

function validPostingExpectation(expected: ReceiptPostingExpectation): boolean {
  if (
    !Array.isArray(expected.paymentLines) ||
    expected.paymentLines.some(
      (line) => !line || !isRealN3Id(line.id) || typeof line.code !== "string" || !line.code.trim(),
    )
  )
    return false;
  const ids = expected.paymentLines.map((line) => line.id.toLowerCase());
  return (
    isRealN3Id(expected.identity.n3ReceiptId) &&
    !!expected.identity.n3DocCode &&
    positiveInt(expected.customerId) !== null &&
    positiveInt(expected.currencyId) !== null &&
    !!expected.customerCode &&
    !!expected.currencyCode &&
    expected.paymentLines.length > 0 &&
    new Set(ids).size === ids.length &&
    expected.paymentLines.every(
      (line) =>
        isRealN3Id(line.id) &&
        !!line.code &&
        moneyCents(line.amount) !== null &&
        moneyCents(line.amount)! > 0,
    ) &&
    moneyCents(expected.amount) !== null &&
    moneyCents(expected.amount)! > 0 &&
    expected.paymentLines.reduce((sum, line) => sum + moneyCents(line.amount)!, 0) ===
      moneyCents(expected.amount)
  );
}

/** A missing or contradictory field is never proof that N3 posted as requested. */
export function verifyReceiptDetail(
  outcome: N3Outcome,
  expected: ReceiptPostingExpectation,
): boolean {
  if (!validPostingExpectation(expected)) return false;
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return false;
  if (!successfulEnvelope(outcome.body)) return false;
  const receipt = unwrap(outcome.body);
  if (!receipt || typeof receipt !== "object") return false;
  const id = str(pick(receipt, ["id"]));
  const docCode = str(pick(receipt, ["docCode"]));
  const customerId = str(pick(receipt, ["customerId"]));
  const currencyId = str(pick(receipt, ["currencyId"]));
  const currencyCode =
    str(pick(receipt, ["currencyCode"])) ?? str(pick(pick(receipt, ["currency"]), ["code"]));
  const total = moneyCents(pick(receipt, ["totalAmount", "netTotalAmount"]));
  if (
    !fieldsAgree(
      receipt,
      ["id"],
      (value) => str(value)?.toLowerCase() === expected.identity.n3ReceiptId.toLowerCase(),
    ) ||
    !fieldsAgree(
      receipt,
      ["docCode", "docNo"],
      (value) => str(value) === expected.identity.n3DocCode,
    ) ||
    !fieldsAgree(receipt, ["docType"], (value) => value === "AROR") ||
    !fieldsAgree(receipt, ["referenceNo"], (value) => value === expected.referenceNo) ||
    !fieldsAgree(receipt, ["customerId"], (value) => str(value) === expected.customerId) ||
    !valuesFor(receipt, ["customer"]).every((obj) =>
      fieldsAgree(obj, ["id"], (value) => str(value) === expected.customerId),
    ) ||
    !fieldsAgree(receipt, ["currencyId"], (value) => str(value) === expected.currencyId) ||
    !valuesFor(receipt, ["currency"]).every((obj) =>
      fieldsAgree(obj, ["id"], (value) => str(value) === expected.currencyId),
    ) ||
    !fieldsAgree(
      receipt,
      ["currencyCode"],
      (value) => str(value)?.toUpperCase() === expected.currencyCode.toUpperCase(),
    ) ||
    !valuesFor(receipt, ["currency"]).every((obj) =>
      fieldsAgree(
        obj,
        ["code"],
        (value) => str(value)?.toUpperCase() === expected.currencyCode.toUpperCase(),
      ),
    ) ||
    !fieldsAgree(
      receipt,
      ["totalAmount", "netTotalAmount"],
      (value) => moneyCents(value) === moneyCents(expected.amount),
    ) ||
    !fieldsAgree(
      receipt,
      ["outstandingAmount"],
      (value) => moneyCents(value) === moneyCents(expected.amount),
    ) ||
    !fieldsAgree(
      receipt,
      ["isMultiPayment"],
      (value) => value === expected.paymentLines.length > 1,
    ) ||
    !fieldsAgree(receipt, ["knockoff"], (value) => Array.isArray(value) && value.length === 0)
  )
    return false;
  if (
    id?.toLowerCase() !== expected.identity.n3ReceiptId.toLowerCase() ||
    docCode !== expected.identity.n3DocCode ||
    str(pick(receipt, ["docType"])) !== "AROR" ||
    customerId !== expected.customerId ||
    str(pick(receipt, ["referenceNo"])) !== expected.referenceNo ||
    !currencyId ||
    currencyId !== expected.currencyId ||
    currencyCode?.toUpperCase() !== expected.currencyCode.toUpperCase() ||
    total !== moneyCents(expected.amount) ||
    moneyCents(pick(receipt, ["outstandingAmount"])) !== moneyCents(expected.amount) ||
    inactiveReceipt(receipt) ||
    !Array.isArray(pick(receipt, ["knockoff"])) ||
    pick(receipt, ["knockoff"]).length !== 0
  )
    return false;

  const selected = expected.paymentLines;
  if (selected.length === 1) {
    const actualId = str(pick(receipt, ["accountId"]));
    return (
      actualId?.toLowerCase() === selected[0]!.id.toLowerCase() &&
      fieldsAgree(
        receipt,
        ["accountId"],
        (value) => str(value)?.toLowerCase() === selected[0]!.id.toLowerCase(),
      ) &&
      [false, undefined].includes(pick(receipt, ["isMultiPayment"]))
    );
  }
  if (selected.length < 2 || pick(receipt, ["isMultiPayment"]) !== true) return false;
  const arrays = valuesFor(receipt, ["multiPayments"]);
  if (!arrays.length) return false;
  return arrays.every((payments) => {
    if (!Array.isArray(payments) || payments.length !== selected.length) return false;
    const remaining = new Map(
      selected.map((line) => [line.id.toLowerCase(), moneyCents(line.amount)]),
    );
    for (const line of payments) {
      const accountId = str(pick(line, ["accountId"]))?.toLowerCase();
      const amount = moneyCents(pick(line, ["amount"]));
      if (!accountId || !remaining.has(accountId) || amount !== remaining.get(accountId))
        return false;
      if (
        !fieldsAgree(line, ["accountId"], (value) => str(value)?.toLowerCase() === accountId) ||
        !fieldsAgree(line, ["amount"], (value) => moneyCents(value) === amount)
      )
        return false;
      remaining.delete(accountId);
    }
    return remaining.size === 0;
  });
}

function journalRows(body: unknown): unknown[] | null {
  if (!successfulEnvelope(body)) return null;
  let value = (body as any).data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value;
  const lines = pick(value, ["details", "lines", "value"]);
  return Array.isArray(lines) ? lines : null;
}

/** Require the exact chosen debits and one customer credit, with no extra posting lines. */
export function verifyReceiptJournal(
  outcome: N3Outcome,
  expected: ReceiptPostingExpectation,
): boolean {
  if (!validPostingExpectation(expected)) return false;
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return false;
  const lines = journalRows(outcome.body);
  if (!lines || lines.length !== expected.paymentLines.length + 1) return false;
  const remaining = [...expected.paymentLines];
  let debitTotal = 0;
  let creditTotal = 0;
  let customerCredits = 0;
  for (const row of lines) {
    const account = pick(row, ["account", "accountCodeLookup"]);
    const id = str(pick(row, ["accountId", "glAccountId"])) ?? str(pick(account, ["id"]));
    const code = str(pick(row, ["accountCode", "glAccountCode"])) ?? str(pick(account, ["code"]));
    const debit = moneyCents(pick(row, ["debit", "debitAmount"]));
    const credit = moneyCents(pick(row, ["credit", "creditAmount"]));
    if (!code && !id) return false;
    if (debit === null || credit === null || debit > 0 === credit > 0) return false;
    const accountObjects = valuesFor(row, ["account", "accountCodeLookup"]);
    if (
      !fieldsAgree(
        row,
        ["accountId", "glAccountId"],
        (value) => str(value)?.toLowerCase() === id?.toLowerCase(),
      ) ||
      !fieldsAgree(row, ["accountCode", "glAccountCode"], (value) => str(value) === code) ||
      accountObjects.some(
        (account) =>
          !fieldsAgree(
            account,
            ["id"],
            (value) => str(value)?.toLowerCase() === id?.toLowerCase(),
          ) || !fieldsAgree(account, ["code"], (value) => str(value) === code),
      ) ||
      !fieldsAgree(row, ["debit", "debitAmount"], (value) => moneyCents(value) === debit) ||
      !fieldsAgree(row, ["credit", "creditAmount"], (value) => moneyCents(value) === credit)
    )
      return false;
    debitTotal += debit;
    creditTotal += credit;
    if (debit > 0) {
      const index = remaining.findIndex(
        (line) =>
          !!id &&
          id.toLowerCase() === line.id.toLowerCase() &&
          (code ? code === line.code : true) &&
          debit === moneyCents(line.amount),
      );
      if (index < 0) return false;
      remaining.splice(index, 1);
    } else {
      if (code !== expected.customerCode || credit !== moneyCents(expected.amount)) return false;
      customerCredits++;
    }
  }
  return (
    remaining.length === 0 &&
    customerCredits === 1 &&
    debitTotal === moneyCents(expected.amount) &&
    creditTotal === debitTotal
  );
}

async function readBackReceiptPosting(
  n3: N3ReceiptsClient,
  token: string,
  expected: ReceiptPostingExpectation,
): Promise<PostingReadback> {
  const detail = await n3.getById(token, expected.identity.n3ReceiptId);
  if (!verifyReceiptDetail(detail, expected))
    return {
      kind: "unknown",
      code: "n3_receipt_readback_uncertain",
      unauthorized: detail.kind === "response" && detail.status === 401,
    };
  const journal = await n3.getGLPosting(token, expected.identity.n3ReceiptId);
  if (!verifyReceiptJournal(journal, expected))
    return {
      kind: "unknown",
      code: "n3_journal_readback_uncertain",
      unauthorized: journal.kind === "response" && journal.status === 401,
    };
  return { kind: "verified" };
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
  if (!successfulEnvelope(outcome.body)) return null;
  const list = rows(outcome.body);
  if (
    list.some((row) => {
      const references = valuesFor(row, ["referenceNo"]);
      return (
        references.some((ref) => str(ref) === expected.referenceNo) &&
        !references.every((ref) => str(ref) === expected.referenceNo)
      );
    })
  )
    return { conflict: true };
  const sameRef = list.filter(
    (r) => str(pick(r, ["referenceNo", "ReferenceNo"])) === expected.referenceNo,
  );
  if (sameRef.length === 0) return null;
  if (sameRef.length !== 1) return { conflict: true };
  for (const r of sameRef) {
    const docType = str(pick(r, ["docType", "DocType"]));
    if (docType !== "AROR") return { conflict: true };
    const id = str(pick(r, ["id", "Id"]));
    const docCode = str(pick(r, ["docCode", "DocCode", "docNo", "DocNo"]));
    if (!isRealN3Id(id) || !docCode) return { conflict: true };
    const custObj = pick(r, ["customer", "Customer"]);
    const cust = str(pick(r, ["customerId", "CustomerId"])) ?? str(pick(custObj, ["id"]));
    if (cust !== expected.customerId || inactiveReceipt(r)) return { conflict: true };
    const currency =
      str(pick(r, ["currencyId", "CurrencyId"])) ??
      str(pick(pick(r, ["currency", "Currency"]), ["id"]));
    if (!expected.currencyId || currency !== expected.currencyId) {
      return { conflict: true };
    }
    const total = num(pick(r, ["netTotalAmount", "totalAmount", "amount", "paymentAmount"]));
    if (total === null || Math.abs(total - expected.amount) > 0.005) return { conflict: true };
    if (
      !fieldsAgree(r, ["id", "receiptId"], (v) => str(v)?.toLowerCase() === id.toLowerCase()) ||
      !fieldsAgree(r, ["docCode", "docNo"], (v) => str(v) === docCode) ||
      !fieldsAgree(r, ["docType"], (v) => v === "AROR") ||
      !fieldsAgree(r, ["customerId"], (v) => str(v) === expected.customerId) ||
      !valuesFor(r, ["customer"]).every((obj) =>
        fieldsAgree(obj, ["id"], (v) => str(v) === expected.customerId),
      ) ||
      !fieldsAgree(r, ["currencyId"], (v) => str(v) === expected.currencyId) ||
      !valuesFor(r, ["currency"]).every((obj) =>
        fieldsAgree(obj, ["id"], (v) => str(v) === expected.currencyId),
      ) ||
      !fieldsAgree(
        r,
        ["netTotalAmount", "totalAmount", "amount", "paymentAmount"],
        (v) => moneyCents(v) === moneyCents(expected.amount),
      )
    )
      return { conflict: true };
    return { match: { n3ReceiptId: id as string, n3DocCode: docCode } };
  }
  return null;
}

/**
 * Fail-closed classification of the exact-reference preflight read.
 * Only `none` (a readable, successful, zero-match page) may proceed to Create.
 */
export type PreflightVerdict =
  | { kind: "none" }
  | { kind: "match"; identity: ReceiptIdentity }
  | { kind: "conflict" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; code: string };

export function classifyPreflight(
  outcome: N3Outcome,
  expected: {
    customerId: string;
    referenceNo: string;
    amount: number;
    currencyId: string | null;
  },
): PreflightVerdict {
  if (outcome.kind === "transport_error") {
    return { kind: "unavailable", code: `n3_${outcome.reason}` };
  }
  if (outcome.status === 401) return { kind: "unauthorized" };
  // 403 must never be treated as session expiry.
  if (outcome.status === 403) return { kind: "unavailable", code: "n3_preflight_forbidden" };
  if (outcome.status < 200 || outcome.status >= 300) {
    return { kind: "unavailable", code: "n3_preflight_status" };
  }
  if (!successfulEnvelope(outcome.body)) {
    return { kind: "unavailable", code: "n3_preflight_rejected" };
  }
  // The contract must be readable: a list envelope is required. A null /
  // unparsable / non-list body is NOT proof of "no existing document".
  const b: any = outcome.body;
  const listLike =
    Array.isArray(b?.data?.value) ||
    Array.isArray(b?.data) ||
    Array.isArray(b?.value) ||
    Array.isArray(b);
  if (!listLike) return { kind: "unavailable", code: "n3_preflight_unreadable" };

  const found = matchExistingReceipt(outcome, expected);
  if (found && "conflict" in found) return { kind: "conflict" };
  if (found && "match" in found) return { kind: "match", identity: found.match };
  if (rows(outcome.body).length !== 0) return { kind: "conflict" };
  return { kind: "none" };
}

// ---------------------------------------------------------------- persistence

export type DepositRecord = {
  id: string;
  clientRequestId?: string | null;
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
  paymentLines: VerifiedPaymentLine[];
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
    clientRequestId: row.idempotency_key ?? null,
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
    paymentLines: Array.isArray(row.payment_lines) ? row.payment_lines : [],
    description: row.description ?? null,
    createdByN3UserKey: row.created_by_n3_user_key,
    lastErrorCode: row.last_error_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "id, idempotency_key, reservation_id, amount, currency_code, status, n3_reference_no, n3_receipt_id, n3_doc_code, n3_customer_code, n3_customer_name, n3_account_code, n3_account_name, payment_lines, description, created_by_n3_user_key, last_error_code, created_at, updated_at";

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

async function findByIdempotencyKey(tenantId: string, key: string): Promise<DepositRecord | null> {
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
  paymentLines?: PaymentChoice[];
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
  if (!isDepositReservationEligible(res.data.status))
    throw new DepositError("reservation_not_eligible");
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
  const choices = validatePaymentChoices(amount, input.paymentLines);
  if (!isUuidLike(input.clientRequestId)) throw new DepositError("invalid_client_request_id");
  if (!isUuidLike(input.reservationId)) throw new DepositError("reservation_not_found");

  // A repeat of the same client request returns the existing result and
  // never issues a second N3 create call.
  const existing = await findByIdempotencyKey(input.tenantId, input.clientRequestId);
  if (existing) {
    if (
      existing.amount !== amount ||
      JSON.stringify(existing.paymentLines.map((l) => ({ accountId: l.id, amount: l.amount }))) !==
        JSON.stringify(choices)
    )
      throw new DepositError("invalid_payment_lines");
    return { deposit: existing, reused: true };
  }
  if (
    choices.length > 1 &&
    (env ?? process.env).HOTELHUB_N3_MULTI_PAYMENT_WRITES_ENABLED !== "true"
  )
    throw new DepositError("multi_payment_contract_unverified");

  const reservation = await loadEligibleReservation(input.tenantId, input.reservationId);
  const settings = await getOrCreateHotelSettings(input.tenantId);
  requireShownPaymentMethods(choices, settings.paymentAccountVisibility);
  if (!settings.walkInCustomer?.n3Id || !settings.walkInCustomer?.n3Code) {
    throw new DepositError("walk_in_customer_not_mapped");
  }

  const defaultsOutcome = await n3.getNew(input.n3Token);
  if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401) {
    throw new DepositError("unauthorized");
  }
  if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 403) {
    // Forbidden is not expiry: fail closed without touching the session.
    throw new DepositError("n3_defaults_unavailable");
  }
  const defaults = requireReceiptDefaults(defaultsOutcome);

  if (
    defaults.currencyCode !== settings.currency.toUpperCase() ||
    reservation.currency.toUpperCase() !== settings.currency.toUpperCase()
  )
    throw new DepositError("n3_defaults_currency_conflict");

  if (positiveInt(settings.walkInCustomer.n3Id) === null) {
    throw new DepositError("walk_in_customer_not_mapped");
  }
  const paymentLines = await verifyPaymentLines(n3, input.n3Token, defaults, amount, choices);
  const account = paymentLines.length === 1 ? paymentLines[0] : null;

  const description = buildDepositDescription(reservation.booking_reference);
  const contact = await readReceiptContact(input.tenantId, input.reservationId);

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
      n3_customer_name: contact.customerName,
      n3_account_id: account?.id ?? null,
      n3_account_code: account?.code ?? null,
      n3_account_name: account?.name ?? null,
      payment_lines: paymentLines,
      description,
      created_by_n3_user_key: input.actorN3UserKey,
    })
    .select(SELECT_COLS)
    .maybeSingle();

  if (claim.error || !claim.data) {
    // Lost the race with a concurrent duplicate: return that row, no POST.
    const raced = await findByIdempotencyKey(input.tenantId, input.clientRequestId);
    if (raced) {
      if (
        raced.amount !== amount ||
        JSON.stringify(raced.paymentLines.map((l) => ({ accountId: l.id, amount: l.amount }))) !==
          JSON.stringify(choices)
      )
        throw new DepositError("invalid_payment_lines");
      return { deposit: raced, reused: true };
    }
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
  const postingExpected = (identity: ReceiptIdentity): ReceiptPostingExpectation => ({
    ...expected,
    identity,
    customerCode: settings.walkInCustomer!.n3Code,
    currencyCode: deposit.currencyCode,
    paymentLines,
  });

  // Pre-flight read-only reconciliation. FAIL CLOSED: the create only happens
  // after a readable, successful, zero-match preflight.
  const pre = await n3.listByReference(input.n3Token, referenceNo);
  const verdictPre = classifyPreflight(pre, expected);

  if (verdictPre.kind === "unauthorized") {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "failed",
      last_error_code: "n3_preflight_unavailable",
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.failed",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        code: "n3_unauthorized",
        created: false,
      },
    });
    // Definite N3 401 — the caller destroys the HotelHub session.
    throw new DepositError("unauthorized");
  }

  if (verdictPre.kind === "unavailable") {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "failed",
      last_error_code: "n3_preflight_unavailable",
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.failed",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        code: verdictPre.code,
        created: false,
      },
    });
    return { deposit, reused: false };
  }

  if (verdictPre.kind === "conflict") {
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "failed",
      last_error_code: "reference_conflict",
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.failed",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        code: "reference_conflict",
      },
    });
    return { deposit, reused: false };
  }

  if (verdictPre.kind === "match") {
    const checked = await readBackReceiptPosting(
      n3,
      input.n3Token,
      postingExpected(verdictPre.identity),
    );
    if (checked.kind !== "verified") {
      deposit = await updateDeposit(input.tenantId, deposit.id, {
        status: "unknown",
        n3_receipt_id: verdictPre.identity.n3ReceiptId,
        n3_doc_code: verdictPre.identity.n3DocCode,
        last_error_code: checked.code,
      });
      await logAudit({
        tenantId: input.tenantId,
        n3UserKey: input.actorN3UserKey,
        eventType: "hotel.deposit.unknown",
        detail: { depositId: deposit.id, reservationId: input.reservationId, code: checked.code },
      });
      if (checked.unauthorized) throw new DepositError("unauthorized");
      return { deposit, reused: false };
    }
    deposit = await updateDeposit(input.tenantId, deposit.id, {
      status: "posted",
      n3_receipt_id: verdictPre.identity.n3ReceiptId,
      n3_doc_code: verdictPre.identity.n3DocCode,
      last_error_code: null,
    });
    await logAudit({
      tenantId: input.tenantId,
      n3UserKey: input.actorN3UserKey,
      eventType: "hotel.deposit.reconciled",
      detail: {
        depositId: deposit.id,
        reservationId: input.reservationId,
        n3ReceiptId: verdictPre.identity.n3ReceiptId,
        n3DocCode: verdictPre.identity.n3DocCode,
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
    paymentLines,
    contact,
  });

  const created = await n3.create(input.n3Token, payload);
  const verdict = classifyCreateOutcome(created, expected);

  if (verdict.verdict === "posted") {
    const checked = await readBackReceiptPosting(
      n3,
      input.n3Token,
      postingExpected(verdict.identity),
    );
    if (checked.kind !== "verified") {
      deposit = await updateDeposit(input.tenantId, deposit.id, {
        status: "unknown",
        n3_receipt_id: verdict.identity.n3ReceiptId,
        n3_doc_code: verdict.identity.n3DocCode,
        last_error_code: checked.code,
      });
      await logAudit({
        tenantId: input.tenantId,
        n3UserKey: input.actorN3UserKey,
        eventType: "hotel.deposit.unknown",
        detail: { depositId: deposit.id, reservationId: input.reservationId, code: checked.code },
      });
      if (checked.unauthorized) throw new DepositError("unauthorized");
      return { deposit, reused: false };
    }
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
  if (verdict.code === "n3_unauthorized") {
    // Definite create-time N3 401: the ledger row stays `unknown` (never
    // blindly retried) and the caller destroys the HotelHub session.
    throw new DepositError("unauthorized");
  }
  return { deposit, reused: false };
}

/** Statuses a GET-only reconciliation may act on (interrupted or uncertain). */
export const RECOVERABLE_DEPOSIT_STATUSES = new Set(["submitting", "unknown"]);

export function isRecoverableDepositStatus(s: string): boolean {
  return RECOVERABLE_DEPOSIT_STATUSES.has(s);
}

/**
 * Owner-triggered "Check N3 Result". GET-only against N3: it can move an
 * interrupted `submitting` row or an `unknown` row to `posted`, and can never
 * create a document. A no-match outcome resolves to `unknown` — never
 * `failed`, and never an automatic retry of the write.
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
  if (!isRecoverableDepositStatus(deposit.status)) {
    throw new DepositError("deposit_not_recoverable");
  }

  const sb = await admin();
  const snap = await sb
    .from("hotel_reservation_deposits")
    .select("n3_customer_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.depositId)
    .maybeSingle();
  const customerId = snap.data?.n3_customer_id ?? null;
  if (!customerId) throw new DepositError("walk_in_customer_not_mapped");

  const uncertain = async (code: string, found?: ReceiptIdentity): Promise<DepositRecord> => {
    // Still uncertain. Never auto-retry the create, never mark failed.
    if (
      deposit.status === "submitting" ||
      deposit.lastErrorCode !== code ||
      (found && deposit.n3ReceiptId !== found.n3ReceiptId)
    ) {
      const stalled = await updateDeposit(input.tenantId, deposit.id, {
        status: "unknown",
        last_error_code: code,
        ...(found ? { n3_receipt_id: found.n3ReceiptId, n3_doc_code: found.n3DocCode } : {}),
      });
      await logAudit({
        tenantId: input.tenantId,
        n3UserKey: input.actorN3UserKey,
        eventType: "hotel.deposit.unknown",
        detail: {
          depositId: stalled.id,
          reservationId: input.reservationId,
          code,
          via: "manual_check",
        },
      });
      return stalled;
    }
    return deposit;
  };

  let identity: ReceiptIdentity;
  const defaultsOutcome = await n3.getNew(input.n3Token);
  if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401)
    throw new DepositError("unauthorized");
  const defaultsRead = readNewReceiptDefaults(defaultsOutcome, false);
  if (!defaultsRead.ok) return uncertain("n3_receipt_readback_uncertain");
  const defaults = defaultsRead.defaults;
  if (defaults.currencyCode !== deposit.currencyCode.toUpperCase())
    return uncertain("n3_receipt_readback_uncertain");
  if (deposit.n3ReceiptId && deposit.n3DocCode) {
    if (!isRealN3Id(deposit.n3ReceiptId)) return uncertain("n3_receipt_readback_uncertain");
    identity = { n3ReceiptId: deposit.n3ReceiptId, n3DocCode: deposit.n3DocCode };
  } else {
    const outcome = await n3.listByReference(input.n3Token, deposit.n3ReferenceNo);
    if (outcome.kind === "response" && outcome.status === 401)
      throw new DepositError("unauthorized");
    if (outcome.kind === "response" && outcome.status === 403)
      throw new DepositError("n3_preflight_unavailable");
    const match = matchExistingReceipt(outcome, {
      customerId,
      referenceNo: deposit.n3ReferenceNo,
      amount: deposit.amount,
      currencyId: defaults.currencyId,
    });
    if (!match || "conflict" in match) return uncertain("n3_result_uncertain");
    identity = match.match;
  }
  if (!deposit.n3CustomerCode || deposit.paymentLines.length < 1)
    return uncertain("n3_receipt_readback_uncertain", identity);
  const checked = await readBackReceiptPosting(n3, input.n3Token, {
    identity,
    customerId,
    customerCode: deposit.n3CustomerCode,
    referenceNo: deposit.n3ReferenceNo,
    amount: deposit.amount,
    currencyId: defaults.currencyId,
    currencyCode: deposit.currencyCode,
    paymentLines: deposit.paymentLines,
  });
  if (checked.kind !== "verified") {
    const result = await uncertain(checked.code, identity);
    if (checked.unauthorized) throw new DepositError("unauthorized");
    return result;
  }
  const updated = await updateDeposit(input.tenantId, deposit.id, {
    status: "posted",
    n3_receipt_id: identity.n3ReceiptId,
    n3_doc_code: identity.n3DocCode,
    last_error_code: null,
  });
  await logAudit({
    tenantId: input.tenantId,
    n3UserKey: input.actorN3UserKey,
    eventType: "hotel.deposit.reconciled",
    detail: {
      depositId: updated.id,
      reservationId: input.reservationId,
      n3ReceiptId: identity.n3ReceiptId,
      n3DocCode: identity.n3DocCode,
      via: "manual_check",
    },
  });
  return updated;
}

/**
 * Owner-triggered, read-only confirmation preview. Uses the same authoritative
 * server sources as the create path (reservation, tenant walk-in mapping and
 * `GET /api/ARReceipts/New`) but returns LABELS ONLY — never internal N3 ids,
 * tokens or raw payloads. It makes no N3 write of any kind.
 */
export type DepositPreview = {
  bookingReference: string;
  customerLabel: string;
  amount: number;
  currency: string;
  accountLabel: string | null;
  paymentLines: Array<{ accountLabel: string; amount: number }>;
  warning: string;
};

export const DEPOSIT_CREATE_WARNING = "This creates a real accounting document in N3.";

export async function buildDepositPreview(
  input: {
    tenantId: string;
    n3TenantKey: string;
    reservationId: string;
    n3Token: string;
    amount: number;
    paymentLines?: PaymentChoice[];
  },
  deps: DepositDeps = {},
): Promise<DepositPreview> {
  const n3 = deps.n3 ?? n3Receipts;
  const env = deps.env;
  if (!isDepositWriteEnabled(input.n3TenantKey, env ?? (process.env as any))) {
    throw new DepositError("deposit_writes_disabled");
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) throw new DepositError("invalid_amount");
  const choices = validatePaymentChoices(amount, input.paymentLines);
  if (!isUuidLike(input.reservationId)) throw new DepositError("reservation_not_found");
  if (
    choices.length > 1 &&
    (env ?? process.env).HOTELHUB_N3_MULTI_PAYMENT_WRITES_ENABLED !== "true"
  ) {
    throw new DepositError("multi_payment_contract_unverified");
  }

  const reservation = await loadEligibleReservation(input.tenantId, input.reservationId);
  const settings = await getOrCreateHotelSettings(input.tenantId);
  requireShownPaymentMethods(choices, settings.paymentAccountVisibility);
  if (!settings.walkInCustomer?.n3Id || !settings.walkInCustomer?.n3Code) {
    throw new DepositError("walk_in_customer_not_mapped");
  }

  const outcome = await n3.getNew(input.n3Token);
  if (outcome.kind === "response" && outcome.status === 401) {
    throw new DepositError("unauthorized");
  }
  if (outcome.kind === "response" && outcome.status === 403) {
    throw new DepositError("n3_defaults_unavailable");
  }
  const defaults = requireReceiptDefaults(outcome);

  if (
    defaults.currencyCode !== settings.currency.toUpperCase() ||
    reservation.currency.toUpperCase() !== settings.currency.toUpperCase()
  )
    throw new DepositError("n3_defaults_currency_conflict");

  if (positiveInt(settings.walkInCustomer.n3Id) === null) {
    throw new DepositError("walk_in_customer_not_mapped");
  }
  const paymentLines = await verifyPaymentLines(n3, input.n3Token, defaults, amount, choices);

  const contact = await readReceiptContact(input.tenantId, input.reservationId);
  const displayAccount = (line: VerifiedPaymentLine) =>
    `${settings.paymentAccountAliases?.[line.id.toLowerCase()] ?? line.name} (${line.code})`;
  return {
    bookingReference: reservation.booking_reference,
    customerLabel: contact.customerName,
    amount,
    currency: settings.currency,
    accountLabel: paymentLines.length === 1 ? displayAccount(paymentLines[0]!) : null,
    paymentLines: paymentLines.map((l) => ({
      accountLabel: displayAccount(l),
      amount: l.amount,
    })),
    warning: DEPOSIT_CREATE_WARNING,
  };
}

/** Sanitized browser-facing DTO. Never includes N3 internal customer/account ids. */
export function toDepositDTO(
  d: DepositRecord & {
    effectiveState?: "active" | "voided";
    needsReview?: boolean;
    originalAmount?: number;
    effectivePaymentLines?: Array<{
      accountId: string;
      code: string;
      savedName: string;
      amountCents: number;
    }>;
  },
  labels?: ReadonlyMap<string, string>,
  aliases?: Readonly<Record<string, string>>,
) {
  return {
    id: d.id,
    clientRequestId: d.clientRequestId ?? null,
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
    paymentLines: d.effectivePaymentLines
      ? d.effectivePaymentLines.map((l) => ({
          accountLabel: `${l.code} — ${l.savedName}`,
          code: l.code,
          displayName: aliases?.[l.accountId.toLowerCase()] || l.savedName,
          amount: l.amountCents / 100,
        }))
      : d.paymentLines.map((l) => ({
          accountLabel: `${l.code} — ${l.name}`,
          code: l.code,
          displayName: aliases?.[l.id.toLowerCase()] || l.name,
          amount: l.amount,
        })),
    effectiveState: d.effectiveState ?? null,
    needsReview: d.needsReview === true,
    originalAmount: d.originalAmount ?? null,
    description: d.description,
    // Run 5D2.1 privacy: the raw N3 user key is NEVER a display value.
    createdByLabel: labels?.get(d.createdByN3UserKey) ?? null,
    createdAt: d.createdAt,
    errorCode: d.lastErrorCode,
  };
}
