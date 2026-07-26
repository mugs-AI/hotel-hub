// Server-only N3 Financial Verification helpers.
//
// READ-ONLY. This module is only permitted to issue authenticated GETs to
// N3 Cloud endpoints. It never creates, updates, voids, matches, refunds
// or deletes any N3 record. The results feed the Owner-only
// `/settings/n3-financial-verification` screen whose job is to discover
// the exact live N3 Cloud contract for AR Receipts, Cash Sales, Customer
// Refunds and the GL Chart of Accounts before Run 5D payment writes
// are implemented.
//
// The endpoint paths below are CANDIDATES. The verification screen
// reports the exact live status/envelope for each attempted candidate so
// the actual Cloud contract can be locked down from real responses.
import { callN3Path } from "./n3-gateway.server";

/** Business resources this console verifies. */
export type FinResource = "ar_receipts" | "cash_sales" | "customer_refunds" | "gl_accounts";

/** MAF evidence label attached to each row/conclusion in the UI. */
export type MafLabel =
  | "Documented Contract"
  | "Live N3 Confirmed"
  | "Desktop Supporting Evidence"
  | "Inference"
  | "Not Available"
  | "Mismatch";

export type FetchStatus =
  | "success"
  | "unavailable"
  | "unauthorized"
  | "invalid_contract"
  | "failed";

const RESOURCE_CANDIDATES: Record<FinResource, string[]> = {
  // AR Receive Payments (OR-*). Try the most likely N3 Cloud names first.
  ar_receipts: ["/api/arreceive/list", "/api/arreceipts/list", "/api/ar/receipts/list"],
  // Cash Sales (CS-*).
  cash_sales: ["/api/cashsales/list", "/api/cs/list"],
  // Customer Refunds (RF-*).
  customer_refunds: [
    "/api/customerrefunds/list",
    "/api/debtorrefund/list",
    "/api/customer-refunds/list",
  ],
  // Chart of Accounts (posting/leaf GL accounts).
  gl_accounts: ["/api/glaccounts/list", "/api/chartofaccount/list", "/api/coa/list"],
};

const PAGE_TOP = 100;
const HARD_CAP = 10_000;
const MAX_RANGE_DAYS = 31;

/** Inclusive `YYYY-MM-DD` date-range validator that never trusts the browser. */
export function parseDateRange(
  from: unknown,
  to: unknown,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== "string" || !isoRe.test(from)) return { ok: false, error: "date_from_invalid" };
  if (typeof to !== "string" || !isoRe.test(to)) return { ok: false, error: "date_to_invalid" };
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return { ok: false, error: "date_invalid" };
  if (t < f) return { ok: false, error: "date_to_before_from" };
  const days = Math.floor((t - f) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: "date_range_exceeds_31_days" };
  return { ok: true, from, to };
}

/** Strip anything sensitive or oversized before returning to the browser. */
const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
  "token",
  "password",
  "identityno",
  "identitynumber",
  "passportno",
  "passport",
  "mykadno",
  "mykad",
  "icnumber",
  "ic",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth_limited]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 4096 ? value.slice(0, 4096) + "…" : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const cap = Math.min(value.length, 200);
    const out: unknown[] = [];
    for (let i = 0; i < cap; i++) out.push(sanitize(value[i], depth + 1));
    if (value.length > cap) out.push(`…${value.length - cap} more`);
    return out;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return "[unsupported]";
}

export type SanitizedCall = {
  endpoint: string;
  method: "GET";
  query: Record<string, string>;
  httpStatus: number | null;
  envelopeCode: string | null;
  envelopeMessage: string | null;
  durationMs: number;
  timestamp: string;
  responseSample: unknown; // sanitized, capped
  error?: string;
};

function envelopeCodeOf(body: unknown): { code: string | null; message: string | null } {
  if (!isPlainObject(body)) return { code: null, message: null };
  const code = body.code ?? body.Code;
  const message = body.message ?? body.Message;
  return {
    code: typeof code === "string" ? code : typeof code === "number" ? String(code) : null,
    message: typeof message === "string" ? message : null,
  };
}

function pageItemsOf(body: unknown): unknown[] | null {
  if (!isPlainObject(body)) return null;
  const data = body.data ?? body.Data;
  if (Array.isArray(data)) return data;
  if (isPlainObject(data)) {
    const v = data.value ?? data.Value ?? data.items ?? data.Items;
    if (Array.isArray(v)) return v;
  }
  const v = body.value ?? body.Value ?? body.items ?? body.Items;
  if (Array.isArray(v)) return v;
  return null;
}

function pageTotalOf(body: unknown): number | null {
  if (!isPlainObject(body)) return null;
  const data = body.data ?? body.Data;
  const raw = isPlainObject(data)
    ? (data.count ?? data.Count ?? data.total ?? data.Total)
    : (body.count ?? body.Count);
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

async function callOnce(
  token: string,
  path: string,
): Promise<SanitizedCall & { rawItems: unknown[] | null; rawTotal: number | null }> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const [pathOnly, qs = ""] = path.split("?");
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  try {
    const res = await callN3Path(token, path);
    const env = envelopeCodeOf(res.body);
    const items = pageItemsOf(res.body);
    const total = pageTotalOf(res.body);
    return {
      endpoint: pathOnly,
      method: "GET",
      query,
      httpStatus: res.status,
      envelopeCode: env.code,
      envelopeMessage: env.message,
      durationMs: Date.now() - started,
      timestamp,
      responseSample: sanitize(res.body),
      rawItems: items,
      rawTotal: total,
    };
  } catch (err) {
    return {
      endpoint: pathOnly,
      method: "GET",
      query,
      httpStatus: null,
      envelopeCode: null,
      envelopeMessage: null,
      durationMs: Date.now() - started,
      timestamp,
      responseSample: null,
      rawItems: null,
      rawTotal: null,
      error: (err as Error).message?.slice(0, 200) ?? "network_error",
    };
  }
}

export type ResourceReport = {
  resource: FinResource;
  status: FetchStatus;
  chosenEndpoint: string | null;
  attempts: SanitizedCall[]; // ordered list of every candidate we hit
  rows: unknown[]; // sanitized rows in the selected date range
  totalReported: number | null; // as reported by envelope (pre-filter)
  fetched: number; // rows retrieved before date filter
  matched: number; // rows kept after date filter
  pagesFetched: number;
  truncated: boolean;
  elapsedMs: number;
  mafLabel: MafLabel;
  note?: string;
};

/** Extract a plausible ISO document date from a row (case-insensitive). */
function rowDocDate(row: unknown): string | null {
  if (!isPlainObject(row)) return null;
  const keys = [
    "DocDate",
    "docDate",
    "DocumentDate",
    "documentDate",
    "Date",
    "date",
    "TrxDate",
    "trxDate",
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length >= 10) {
      const iso = v.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
  }
  return null;
}

function rowId(row: unknown): string | null {
  if (!isPlainObject(row)) return null;
  for (const k of ["Id", "id", "Guid", "guid", "Uuid", "uuid"]) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** Fetch a full list resource (paged), then filter by inclusive date range. */
async function fetchListResource(
  token: string,
  resource: FinResource,
  from: string,
  to: string,
): Promise<ResourceReport> {
  const startedAll = Date.now();
  const candidates = RESOURCE_CANDIDATES[resource];
  const attempts: SanitizedCall[] = [];
  let chosen: string | null = null;
  let firstOkBody: (SanitizedCall & { rawItems: unknown[] | null; rawTotal: number | null }) | null =
    null;

  for (const base of candidates) {
    const first = await callOnce(token, `${base}?$top=${PAGE_TOP}&$skip=0`);
    attempts.push(first);
    if (first.httpStatus === 401) {
      return {
        resource,
        status: "unauthorized",
        chosenEndpoint: base,
        attempts,
        rows: [],
        totalReported: null,
        fetched: 0,
        matched: 0,
        pagesFetched: 1,
        truncated: false,
        elapsedMs: Date.now() - startedAll,
        mafLabel: "Live N3 Confirmed",
        note: "N3 returned 401 Unauthorized",
      };
    }
    if (first.httpStatus !== null && first.httpStatus >= 200 && first.httpStatus < 300 && first.rawItems) {
      chosen = base;
      firstOkBody = first;
      break;
    }
  }

  if (!chosen || !firstOkBody) {
    // No candidate returned a recognisable page envelope.
    const anyReached = attempts.some((a) => typeof a.httpStatus === "number");
    return {
      resource,
      status: anyReached ? "invalid_contract" : "unavailable",
      chosenEndpoint: null,
      attempts,
      rows: [],
      totalReported: null,
      fetched: 0,
      matched: 0,
      pagesFetched: attempts.length,
      truncated: false,
      elapsedMs: Date.now() - startedAll,
      mafLabel: anyReached ? "Mismatch" : "Not Available",
      note: anyReached
        ? "No candidate endpoint returned a recognised N3 list envelope"
        : "No candidate endpoint reachable",
    };
  }

  const collected: unknown[] = [...(firstOkBody.rawItems ?? [])];
  const reportedTotal = firstOkBody.rawTotal;
  const cap = Math.min(reportedTotal ?? HARD_CAP, HARD_CAP);
  let pages = 1;
  let skip = PAGE_TOP;
  let truncated = false;

  while (collected.length < cap && skip < HARD_CAP) {
    const next = await callOnce(token, `${chosen}?$top=${PAGE_TOP}&$skip=${skip}`);
    pages++;
    // Keep only the first attempt in `attempts[]` to avoid response bloat;
    // record the last call's metadata so we still show something if it
    // errors out mid-scan.
    if (next.error || next.httpStatus === null || next.httpStatus < 200 || next.httpStatus >= 300) {
      attempts.push(next);
      truncated = true;
      break;
    }
    const items = next.rawItems ?? [];
    if (items.length === 0) break;
    collected.push(...items);
    if (typeof reportedTotal !== "number" && items.length < PAGE_TOP) break;
    skip += PAGE_TOP;
  }
  if (collected.length >= HARD_CAP) truncated = true;

  // De-duplicate by immutable id.
  const seen = new Set<string>();
  const deduped: unknown[] = [];
  for (const r of collected) {
    const id = rowId(r);
    const key = id ?? JSON.stringify(r).slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  // Date-range filter (only for transactional resources).
  let matched = deduped;
  if (resource !== "gl_accounts") {
    matched = deduped.filter((row) => {
      const d = rowDocDate(row);
      return d !== null && d >= from && d <= to;
    });
  }

  return {
    resource,
    status: "success",
    chosenEndpoint: chosen,
    attempts,
    rows: matched.map((r) => sanitize(r)),
    totalReported: reportedTotal,
    fetched: deduped.length,
    matched: matched.length,
    pagesFetched: pages,
    truncated,
    elapsedMs: Date.now() - startedAll,
    mafLabel: "Live N3 Confirmed",
  };
}

export type FinancialVerificationRun = {
  runAt: string;
  dateFrom: string;
  dateTo: string;
  tenant: { id: string | null; code: string | null; name: string | null };
  filters: { docNumber?: string; hotelReference?: string; customerCode?: string };
  resources: ResourceReport[];
  elapsedMs: number;
};

export async function runFinancialVerification(input: {
  token: string;
  dateFrom: string;
  dateTo: string;
  tenant: { id: string | null; code: string | null; name: string | null };
  filters?: { docNumber?: string; hotelReference?: string; customerCode?: string };
}): Promise<FinancialVerificationRun> {
  const started = Date.now();
  const resources = await Promise.all([
    fetchListResource(input.token, "ar_receipts", input.dateFrom, input.dateTo),
    fetchListResource(input.token, "cash_sales", input.dateFrom, input.dateTo),
    fetchListResource(input.token, "customer_refunds", input.dateFrom, input.dateTo),
    fetchListResource(input.token, "gl_accounts", input.dateFrom, input.dateTo),
  ]);
  return {
    runAt: new Date().toISOString(),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    tenant: input.tenant,
    filters: input.filters ?? {},
    resources,
    elapsedMs: Date.now() - started,
  };
}

// ---- Bank / Cash GL account classification -----------------------------

const BANK_HINTS = ["bank"];
const CASH_HINTS = ["cash", "petty cash"];

export type GlEligibility = "bank" | "cash" | "ineligible";

export function classifyGlAccount(row: unknown): GlEligibility {
  if (!isPlainObject(row)) return "ineligible";
  const specialRaw = row.SpecialType ?? row.specialType ?? row.SpecialAccountType ?? "";
  const nameRaw = row.Name ?? row.name ?? row.Description ?? row.description ?? "";
  const special = String(specialRaw).toLowerCase();
  const name = String(nameRaw).toLowerCase();
  if (BANK_HINTS.some((h) => special.includes(h))) return "bank";
  if (CASH_HINTS.some((h) => special.includes(h))) return "cash";
  // Fall back to name heuristics only when SpecialType is absent.
  if (special === "") {
    if (BANK_HINTS.some((h) => name.includes(h))) return "bank";
    if (CASH_HINTS.some((h) => name.includes(h))) return "cash";
  }
  return "ineligible";
}

// ---- OR ↔ Cash Memo identity comparison --------------------------------

export type KnockoffMatch = {
  receiptId: string | null;
  receiptDocNo: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  appliedAmount: number | null;
  candidateCashSalesId: string | null;
  candidateCashSalesDocNo: string | null;
  sameUuid: boolean | null;
  customerMatch: boolean | null;
  correlation: "immutable_id" | "document_number_only" | "none";
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function knockoffsOf(row: unknown): unknown[] {
  if (!isPlainObject(row)) return [];
  for (const k of ["knockOffs", "Knockoffs", "KnockOffs", "matched", "Matched", "ARMatched"]) {
    const v = row[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export function compareReceiptKnockoffs(
  arReceipts: unknown[],
  cashSales: unknown[],
): KnockoffMatch[] {
  const csById = new Map<string, Record<string, unknown>>();
  const csByDocNo = new Map<string, Record<string, unknown>>();
  for (const raw of cashSales) {
    if (!isPlainObject(raw)) continue;
    const id = rowId(raw);
    const docNo =
      (raw.DocNo as string | undefined) ?? (raw.docNo as string | undefined) ?? null;
    if (id) csById.set(id.toUpperCase(), raw);
    if (typeof docNo === "string" && docNo) csByDocNo.set(docNo.toUpperCase(), raw);
  }
  const out: KnockoffMatch[] = [];
  for (const rec of arReceipts) {
    if (!isPlainObject(rec)) continue;
    const receiptId = rowId(rec);
    const receiptDocNo =
      (rec.DocNo as string | undefined) ?? (rec.docNo as string | undefined) ?? null;
    for (const k of knockoffsOf(rec)) {
      if (!isPlainObject(k)) continue;
      const docType =
        (k.DocType as string | undefined) ?? (k.docType as string | undefined) ?? null;
      const docId = (k.DocId as string | undefined) ?? (k.docId as string | undefined) ?? null;
      const docNo = (k.DocNo as string | undefined) ?? (k.docNo as string | undefined) ?? null;
      if (docType !== "INV") continue;
      const applied = toNumber(k.AppliedAmount ?? k.appliedAmount ?? k.Amount ?? k.amount);
      const byId = docId ? csById.get(docId.toUpperCase()) : undefined;
      const byNo = !byId && docNo ? csByDocNo.get(docNo.toUpperCase()) : undefined;
      const cs = byId ?? byNo ?? null;
      const csId = cs ? rowId(cs) : null;
      const csDocNo =
        cs && isPlainObject(cs) ? ((cs.DocNo as string | undefined) ?? null) : null;
      const sameUuid = docId && csId ? docId.toUpperCase() === csId.toUpperCase() : null;
      const receiptCustomer =
        (rec.CustomerId as string | undefined) ?? (rec.customerId as string | undefined) ?? null;
      const csCustomer =
        cs && isPlainObject(cs)
          ? ((cs.CustomerId as string | undefined) ?? (cs.customerId as string | undefined) ?? null)
          : null;
      const customerMatch =
        receiptCustomer && csCustomer
          ? receiptCustomer.toUpperCase() === csCustomer.toUpperCase()
          : null;
      out.push({
        receiptId,
        receiptDocNo,
        docType,
        docId,
        docNo,
        appliedAmount: applied,
        candidateCashSalesId: csId,
        candidateCashSalesDocNo: csDocNo,
        sameUuid,
        customerMatch,
        correlation: byId ? "immutable_id" : byNo ? "document_number_only" : "none",
      });
    }
  }
  return out;
}

// ---- AR vs GL-originated OR classification -----------------------------

export type OrClassification = "ar_receipt" | "gl_originated_or" | "unknown";

export function classifyOrOrigin(row: unknown): OrClassification {
  if (!isPlainObject(row)) return "unknown";
  const source =
    row.Source ?? row.source ?? row.OriginModule ?? row.originModule ?? row.FromModule ?? "";
  const s = String(source).toLowerCase();
  if (s.includes("gl") || s.includes("journal")) return "gl_originated_or";
  // AR Receipts should carry a Customer identity.
  const customerId = row.CustomerId ?? row.customerId ?? row.Customer;
  if (customerId) return "ar_receipt";
  return "unknown";
}
