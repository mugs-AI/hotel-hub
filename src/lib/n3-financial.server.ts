// Server-only N3 Financial Verification helpers — Run 5D0 Correction.
//
// READ-ONLY. Only authenticated GET calls to N3 Cloud are permitted here.
// This module never issues POST/PUT/PATCH/DELETE and never creates, updates,
// voids, matches, refunds or deletes any N3 record. It powers the Owner-only
// `/settings/n3-financial-verification` screen to lock the live Cloud
// contract before Run 5D writes.
//
// Contract discipline:
//   - Every candidate endpoint tried is recorded in the evidence bundle with
//     its exact casing, HTTP status, envelope code/message, and a sanitized
//     sample of the response.
//   - A 2xx page is not enough. Each resource has a semantic validator that
//     checks the returned rows expose the fields that identify that
//     resource. Wrong-resource payloads are labelled `Mismatch` and never
//     parsed as that resource.
//   - GL bank/cash eligibility requires immutable id + active + posting/leaf
//     + normalised `SpecialType`. Name-only rows are `unknown`, never
//     eligible.
//   - Detail reads are strictly GET, tenant-scoped, capped at 20 per
//     resource, and driven by immutable N3 IDs returned from the list.

import { callN3Path } from "./n3-gateway.server";

export const FINANCIAL_BUNDLE_SCHEMA_VERSION = "5d0.2";

export type FinResource = "ar_receipts" | "cash_sales" | "customer_refunds" | "gl_accounts";

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

// Endpoint candidates. GL puts the confirmed `/api/GLAccounts/Query`
// (exact casing) first, then keeps only the previously-proven
// `/api/glaccounts/list` fallback. Guessed `/chartofaccount`/`coa` paths
// were removed per the correction brief.
const RESOURCE_CANDIDATES: Record<FinResource, string[]> = {
  ar_receipts: ["/api/arreceive/list", "/api/arreceipts/list"],
  cash_sales: ["/api/cashsales/list"],
  customer_refunds: ["/api/customerrefunds/list", "/api/debtorrefund/list"],
  gl_accounts: ["/api/GLAccounts/Query", "/api/glaccounts/list"],
};

// Root path used to build immutable-ID detail reads. Detail read is a
// GET-only convention (`{list_root}/{id}`) — never a write path.
const RESOURCE_DETAIL_ROOT: Record<Exclude<FinResource, "gl_accounts">, string> = {
  ar_receipts: "/api/arreceive",
  cash_sales: "/api/cashsales",
  customer_refunds: "/api/customerrefunds",
};

const PAGE_TOP = 100;
const HARD_CAP = 10_000;
const MAX_RANGE_DAYS = 31;
const DETAIL_FANOUT_CAP = 20;

// ---- Small utilities ------------------------------------------------------

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return row[k];
  }
  return undefined;
}

function pickWithSource(
  row: Record<string, unknown>,
  keys: string[],
): { value: unknown; sourceField: string | null } {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return { value: row[k], sourceField: k };
  }
  return { value: undefined, sourceField: null };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

function normStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function eq(a: unknown, b: string): boolean {
  const s = normStr(a);
  if (s === null) return false;
  return s.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---- Date range -----------------------------------------------------------

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

// ---- Sanitizer ------------------------------------------------------------

// Recursive, case-insensitive redaction. Extended to cover tokens, secrets,
// connection data, Malaysian identity numbers, and personal/contact fields.
// Never rely on this for authorization; treat it as a belt-and-braces
// defense on top of "never echo tokens".
const REDACT_KEYS = new Set([
  // Authorization + secrets
  "authorization",
  "auth",
  "bearer",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
  "api_key",
  "api-key",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "pwd",
  "secret",
  "clientsecret",
  "client_secret",
  "dbpassword",
  "db_password",
  "connection",
  "connectionstring",
  // Identity documents
  "identityno",
  "identitynumber",
  "identityid",
  "nric",
  "ic",
  "icno",
  "icnumber",
  "mykad",
  "mykadno",
  "mypr",
  "passport",
  "passportno",
  // Personal / contact / address
  "phone",
  "phoneno",
  "mobile",
  "mobileno",
  "handphone",
  "email",
  "emailaddress",
  "address",
  "address1",
  "address2",
  "address3",
  "postcode",
  "postalcode",
  "zip",
  "zipcode",
  "city",
  "state",
  "country",
  "dob",
  "birth",
  "birthdate",
  "dateofbirth",
]);

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

// ---- Envelope helpers -----------------------------------------------------

export type SanitizedCall = {
  endpoint: string;
  method: "GET";
  query: Record<string, string>;
  httpStatus: number | null;
  envelopeCode: string | null;
  envelopeMessage: string | null;
  durationMs: number;
  timestamp: string;
  responseSample: unknown;
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
    const v = data.value ?? data.Value ?? data.items ?? data.Items ?? data.results ?? data.Results;
    if (Array.isArray(v)) return v;
  }
  const v =
    body.value ?? body.Value ?? body.items ?? body.Items ?? body.results ?? body.Results;
  if (Array.isArray(v)) return v;
  return null;
}

function pageTotalOf(body: unknown): number | null {
  if (!isPlainObject(body)) return null;
  const data = body.data ?? body.Data;
  const raw = isPlainObject(data)
    ? (data.count ?? data.Count ?? data.total ?? data.Total ?? data.totalCount ?? data.TotalCount)
    : (body.count ?? body.Count ?? body.total ?? body.Total);
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
): Promise<SanitizedCall & { rawItems: unknown[] | null; rawTotal: number | null; body: unknown }> {
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
      body: res.body,
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
      body: null,
      error: (err as Error).message?.slice(0, 200) ?? "network_error",
    };
  }
}

// ---- Row helpers ----------------------------------------------------------

function rowId(row: unknown): string | null {
  if (!isPlainObject(row)) return null;
  for (const k of ["Id", "id", "Guid", "guid", "Uuid", "uuid"]) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

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

// ---- Semantic contract validators ----------------------------------------

export type ContractValidation = {
  passed: boolean;
  observedFields: string[]; // union of keys observed on first N rows
  requiredHits: Record<string, boolean>; // which required signals we saw
  suspectedResource: FinResource | "ar_credit_note" | "sales_credit_note" | "unknown" | null;
  reason: string;
};

function unionKeys(rows: unknown[], sampleSize = 5): string[] {
  const keys = new Set<string>();
  for (let i = 0; i < Math.min(rows.length, sampleSize); i++) {
    const r = rows[i];
    if (isPlainObject(r)) for (const k of Object.keys(r)) keys.add(k);
  }
  return Array.from(keys).sort();
}

function hasAnyKey(obs: string[], candidates: string[]): boolean {
  const lower = obs.map((k) => k.toLowerCase());
  return candidates.some((c) => lower.includes(c.toLowerCase()));
}

function looksLikeCreditNote(obs: string[]): boolean {
  const lower = obs.map((k) => k.toLowerCase());
  return (
    lower.includes("creditnotetype") ||
    lower.includes("salescreditnote") ||
    lower.includes("arcreditnote") ||
    lower.some((k) => k.includes("creditnote"))
  );
}

function validateContract(resource: FinResource, rows: unknown[]): ContractValidation {
  const obs = unionKeys(rows);
  if (rows.length === 0) {
    return {
      passed: true, // an empty page cannot disprove the contract
      observedFields: obs,
      requiredHits: {},
      suspectedResource: null,
      reason: "empty_page",
    };
  }
  switch (resource) {
    case "ar_receipts": {
      const hasCustomer = hasAnyKey(obs, [
        "CustomerId",
        "customerId",
        "DebtorId",
        "debtorId",
        "CustomerCode",
        "customerCode",
        "DebtorCode",
        "debtorCode",
      ]);
      const hasKnockoff = hasAnyKey(obs, [
        "knockoff",
        "KnockOff",
        "knockOff",
        "knockOffs",
        "Knockoffs",
        "KnockOffs",
        "knockoffs",
      ]);
      const hasDeposit = hasAnyKey(obs, [
        "DepositTo",
        "depositTo",
        "PaymentBy",
        "paymentBy",
      ]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const passed = hasDoc && hasCustomer && (hasKnockoff || hasDeposit);
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasCustomer, hasKnockoff, hasDeposit, hasDoc },
        suspectedResource: passed ? "ar_receipts" : looksLikeCreditNote(obs) ? "ar_credit_note" : "unknown",
        reason: passed ? "ar_receipt_fields_present" : "missing_ar_receipt_signals",
      };
    }
    case "cash_sales": {
      const hasCustomer = hasAnyKey(obs, [
        "CustomerId",
        "customerId",
        "DebtorId",
        "debtorId",
        "CustomerCode",
        "customerCode",
      ]);
      const hasTotal = hasAnyKey(obs, ["Total", "total", "NetTotal", "netTotal", "GrandTotal", "grandTotal"]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const passed = hasDoc && hasCustomer && hasTotal;
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasCustomer, hasTotal, hasDoc },
        suspectedResource: passed ? "cash_sales" : looksLikeCreditNote(obs) ? "sales_credit_note" : "unknown",
        reason: passed ? "cash_sales_fields_present" : "missing_cash_sales_signals",
      };
    }
    case "customer_refunds": {
      if (looksLikeCreditNote(obs)) {
        return {
          passed: false,
          observedFields: obs,
          requiredHits: {},
          suspectedResource: obs.some((k) => k.toLowerCase().includes("sales")) ? "sales_credit_note" : "ar_credit_note",
          reason: "credit_note_payload_rejected_as_refund",
        };
      }
      const hasCustomer = hasAnyKey(obs, [
        "CustomerId",
        "customerId",
        "DebtorId",
        "debtorId",
        "CustomerCode",
        "customerCode",
      ]);
      const hasPaymentBy = hasAnyKey(obs, ["PaymentBy", "paymentBy", "PayFrom", "payFrom"]);
      const hasRefundKnockoff = hasAnyKey(obs, [
        "knockoff",
        "knockOff",
        "knockOffs",
        "Knockoffs",
        "KnockOffs",
        "knockoffs",
        "RefundKnockoff",
        "refundKnockoff",
      ]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const passed = hasDoc && hasCustomer && (hasPaymentBy || hasRefundKnockoff);
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasCustomer, hasPaymentBy, hasRefundKnockoff, hasDoc },
        suspectedResource: passed ? "customer_refunds" : "unknown",
        reason: passed ? "customer_refund_fields_present" : "missing_customer_refund_signals",
      };
    }
    case "gl_accounts": {
      const hasSpecial = hasAnyKey(obs, ["SpecialType", "specialType", "SpecialAccountType"]);
      const hasName = hasAnyKey(obs, ["Name", "name", "AccountName", "accountName", "Description"]);
      const hasCode = hasAnyKey(obs, ["Code", "code", "AccountCode", "accountCode"]);
      const passed = hasName && hasCode; // SpecialType may be absent for some rows
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasSpecial, hasName, hasCode },
        suspectedResource: passed ? "gl_accounts" : "unknown",
        reason: passed ? "gl_account_fields_present" : "missing_gl_account_signals",
      };
    }
  }
}

// ---- Filter engine --------------------------------------------------------

export type NormalizedFilters = {
  docNumber?: string;
  hotelReference?: string;
  customerCode?: string;
};

export type FilterDiagnostic = {
  resource: FinResource;
  requested: NormalizedFilters;
  resolvedFields: {
    docNumber?: string | null;
    hotelReference?: string | null;
    customerCode?: string | null;
  };
  beforeCount: number;
  afterCount: number;
  mismatches: string[]; // filter names whose target field was absent in observed rows
  rejected?: { field: string; reason: string };
};

const DOC_NUMBER_FIELDS = ["DocNo", "docNo", "DocCode", "docCode"];
const HOTEL_REF_FIELDS = [
  "ReferenceNo",
  "referenceNo",
  "Reference",
  "reference",
  "OurRef",
  "ourRef",
  "OurReference",
  "ourReference",
];
const CUSTOMER_CODE_FIELDS = [
  "CustomerCode",
  "customerCode",
  "DebtorCode",
  "debtorCode",
];

function firstPresentField(row: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(row, f)) return f;
  }
  return null;
}

function anyRowHasAny(rows: unknown[], fields: string[]): string | null {
  for (const r of rows) {
    if (!isPlainObject(r)) continue;
    const f = firstPresentField(r, fields);
    if (f) return f;
  }
  return null;
}

function normalizeFilters(input?: NormalizedFilters): NormalizedFilters {
  const out: NormalizedFilters = {};
  if (input?.docNumber && input.docNumber.trim()) out.docNumber = input.docNumber.trim();
  if (input?.hotelReference && input.hotelReference.trim())
    out.hotelReference = input.hotelReference.trim();
  if (input?.customerCode && input.customerCode.trim())
    out.customerCode = input.customerCode.trim();
  return out;
}

export function applyFilters(
  resource: FinResource,
  rows: unknown[],
  filters: NormalizedFilters,
  tenantCustomer: { code: string | null } | null,
): { rows: unknown[]; diagnostic: FilterDiagnostic } {
  const beforeCount = rows.length;
  const diagnostic: FilterDiagnostic = {
    resource,
    requested: filters,
    resolvedFields: {},
    beforeCount,
    afterCount: beforeCount,
    mismatches: [],
  };

  // Only transaction resources filter on document/reference/customer.
  if (resource === "gl_accounts" || Object.keys(filters).length === 0) {
    return { rows, diagnostic };
  }

  // Validate customerCode against tenant's configured HotelHub customer.
  let effectiveFilters: NormalizedFilters = { ...filters };
  if (filters.customerCode) {
    if (!tenantCustomer?.code || !eq(filters.customerCode, tenantCustomer.code)) {
      diagnostic.rejected = {
        field: "customerCode",
        reason: "customer_code_not_configured_hotelhub_customer",
      };
      return { rows: [], diagnostic: { ...diagnostic, afterCount: 0 } };
    }
  }

  const docField = filters.docNumber ? anyRowHasAny(rows, DOC_NUMBER_FIELDS) : null;
  const refField = filters.hotelReference ? anyRowHasAny(rows, HOTEL_REF_FIELDS) : null;
  const custField = filters.customerCode ? anyRowHasAny(rows, CUSTOMER_CODE_FIELDS) : null;

  if (filters.docNumber) diagnostic.resolvedFields.docNumber = docField;
  if (filters.hotelReference) diagnostic.resolvedFields.hotelReference = refField;
  if (filters.customerCode) diagnostic.resolvedFields.customerCode = custField;

  if (filters.docNumber && !docField) diagnostic.mismatches.push("docNumber");
  if (filters.hotelReference && !refField) diagnostic.mismatches.push("hotelReference");
  if (filters.customerCode && !custField) diagnostic.mismatches.push("customerCode");

  const kept = rows.filter((r) => {
    if (!isPlainObject(r)) return false;
    if (effectiveFilters.docNumber) {
      const anyMatch = DOC_NUMBER_FIELDS.some((f) => eq(r[f], effectiveFilters.docNumber!));
      if (!anyMatch) return false;
    }
    if (effectiveFilters.hotelReference) {
      const anyMatch = HOTEL_REF_FIELDS.some((f) => eq(r[f], effectiveFilters.hotelReference!));
      if (!anyMatch) return false;
    }
    if (effectiveFilters.customerCode) {
      const anyMatch = CUSTOMER_CODE_FIELDS.some((f) => eq(r[f], effectiveFilters.customerCode!));
      if (!anyMatch) return false;
    }
    return true;
  });

  diagnostic.afterCount = kept.length;
  return { rows: kept, diagnostic };
}

// ---- Detail fan-out (immutable ID only) ----------------------------------

export type DetailEvidence = {
  sourceListId: string;
  sourceListDocNo: string | null;
  endpoint: string;
  httpStatus: number | null;
  envelopeCode: string | null;
  sanitizedSample: unknown;
  fieldNamesObserved: string[];
  error?: string;
};

export type DetailFanOut = {
  cap: number;
  requested: number; // matched rows count
  performed: number;
  skipped: boolean;
  reason: string | null;
  evidence: DetailEvidence[];
};

async function fetchDetailById(
  token: string,
  root: string,
  id: string,
  sourceListDocNo: string | null,
): Promise<DetailEvidence> {
  const path = `${root}/${encodeURIComponent(id)}`;
  const call = await callOnce(token, path);
  const bodyKeys = isPlainObject(call.body)
    ? Object.keys(call.body)
    : Array.isArray(call.body) && isPlainObject(call.body[0])
      ? Object.keys(call.body[0])
      : [];
  return {
    sourceListId: id,
    sourceListDocNo,
    endpoint: path,
    httpStatus: call.httpStatus,
    envelopeCode: call.envelopeCode,
    sanitizedSample: call.responseSample,
    fieldNamesObserved: bodyKeys,
    ...(call.error ? { error: call.error } : {}),
  };
}

async function fanOutDetails(
  token: string,
  resource: Exclude<FinResource, "gl_accounts">,
  matchedRows: unknown[],
): Promise<DetailFanOut> {
  const root = RESOURCE_DETAIL_ROOT[resource];
  const requested = matchedRows.length;
  if (requested === 0) {
    return { cap: DETAIL_FANOUT_CAP, requested: 0, performed: 0, skipped: false, reason: null, evidence: [] };
  }
  if (requested > DETAIL_FANOUT_CAP) {
    return {
      cap: DETAIL_FANOUT_CAP,
      requested,
      performed: 0,
      skipped: true,
      reason: "narrow_filters_required",
      evidence: [],
    };
  }
  const evidence: DetailEvidence[] = [];
  for (const row of matchedRows) {
    const id = rowId(row);
    if (!id) continue;
    const docNo = isPlainObject(row)
      ? ((row.DocNo as string | undefined) ?? (row.docNo as string | undefined) ?? null)
      : null;
    // Serial to avoid hammering N3 with parallel bursts.
    const ev = await fetchDetailById(token, root, id, docNo);
    evidence.push(ev);
  }
  return {
    cap: DETAIL_FANOUT_CAP,
    requested,
    performed: evidence.length,
    skipped: false,
    reason: null,
    evidence,
  };
}

// ---- Resource fetch (list) -----------------------------------------------

export type EndpointAttempt = SanitizedCall;

export type ResourceReport = {
  resource: FinResource;
  status: FetchStatus;
  chosenEndpoint: string | null;
  endpointAttempts: EndpointAttempt[];
  contractValidation: ContractValidation | null;
  rows: unknown[]; // sanitized rows kept after date + filter application
  matchedRawRows: unknown[]; // raw (unsanitized) rows kept for detail fan-out
  totalReported: number | null;
  fetched: number; // pre-filter (post-dedupe) count
  matched: number; // post-filter count
  pagesFetched: number;
  truncated: boolean;
  elapsedMs: number;
  mafLabel: MafLabel;
  filterDiagnostic: FilterDiagnostic | null;
  detailFanOut: DetailFanOut | null;
  note?: string;
};

async function fetchListResource(
  token: string,
  resource: FinResource,
  from: string,
  to: string,
  filters: NormalizedFilters,
  tenantCustomer: { code: string | null } | null,
): Promise<ResourceReport> {
  const startedAll = Date.now();
  const candidates = RESOURCE_CANDIDATES[resource];
  const attempts: EndpointAttempt[] = [];
  let chosen: string | null = null;
  let firstOk: Awaited<ReturnType<typeof callOnce>> | null = null;

  for (const base of candidates) {
    const first = await callOnce(token, `${base}?$top=${PAGE_TOP}&$skip=0`);
    attempts.push(first);
    if (first.httpStatus === 401) {
      return {
        resource,
        status: "unauthorized",
        chosenEndpoint: base,
        endpointAttempts: attempts,
        contractValidation: null,
        rows: [],
        matchedRawRows: [],
        totalReported: null,
        fetched: 0,
        matched: 0,
        pagesFetched: 1,
        truncated: false,
        elapsedMs: Date.now() - startedAll,
        mafLabel: "Not Available",
        filterDiagnostic: null,
        detailFanOut: null,
        note: "N3 returned 401 Unauthorized",
      };
    }
    if (
      first.httpStatus !== null &&
      first.httpStatus >= 200 &&
      first.httpStatus < 300 &&
      first.rawItems
    ) {
      chosen = base;
      firstOk = first;
      break;
    }
  }

  if (!chosen || !firstOk) {
    const anyReached = attempts.some((a) => typeof a.httpStatus === "number");
    return {
      resource,
      status: anyReached ? "invalid_contract" : "unavailable",
      chosenEndpoint: null,
      endpointAttempts: attempts,
      contractValidation: null,
      rows: [],
      matchedRawRows: [],
      totalReported: null,
      fetched: 0,
      matched: 0,
      pagesFetched: attempts.length,
      truncated: false,
      elapsedMs: Date.now() - startedAll,
      mafLabel: anyReached ? "Mismatch" : "Not Available",
      filterDiagnostic: null,
      detailFanOut: null,
      note: anyReached
        ? "No candidate endpoint returned a recognised N3 list envelope"
        : "No candidate endpoint reachable",
    };
  }

  // Semantic contract check against the first page of rows.
  const firstRows = firstOk.rawItems ?? [];
  const contract = validateContract(resource, firstRows);
  if (!contract.passed) {
    return {
      resource,
      status: "invalid_contract",
      chosenEndpoint: chosen,
      endpointAttempts: attempts,
      contractValidation: contract,
      rows: [],
      matchedRawRows: [],
      totalReported: firstOk.rawTotal,
      fetched: 0,
      matched: 0,
      pagesFetched: 1,
      truncated: false,
      elapsedMs: Date.now() - startedAll,
      mafLabel: "Mismatch",
      filterDiagnostic: null,
      detailFanOut: null,
      note: `Semantic contract failed: ${contract.reason}${
        contract.suspectedResource ? ` (suspected: ${contract.suspectedResource})` : ""
      }`,
    };
  }

  // Page through the rest.
  const collected: unknown[] = [...firstRows];
  const reportedTotal = firstOk.rawTotal;
  const cap = Math.min(reportedTotal ?? HARD_CAP, HARD_CAP);
  let pages = 1;
  let skip = PAGE_TOP;
  let truncated = false;

  while (collected.length < cap && skip < HARD_CAP) {
    const next = await callOnce(token, `${chosen}?$top=${PAGE_TOP}&$skip=${skip}`);
    pages++;
    if (
      next.error ||
      next.httpStatus === null ||
      next.httpStatus < 200 ||
      next.httpStatus >= 300
    ) {
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

  // Dedupe by immutable id.
  const seen = new Set<string>();
  const deduped: unknown[] = [];
  for (const r of collected) {
    const id = rowId(r);
    const key = id ?? JSON.stringify(r).slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  // Date-range filter for transactional resources only.
  let inRange = deduped;
  if (resource !== "gl_accounts") {
    inRange = deduped.filter((row) => {
      const d = rowDocDate(row);
      return d !== null && d >= from && d <= to;
    });
  }

  // Optional business filters.
  const { rows: filtered, diagnostic } = applyFilters(resource, inRange, filters, tenantCustomer);

  // Detail fan-out (transaction resources only).
  let detailFanOut: DetailFanOut | null = null;
  if (resource !== "gl_accounts") {
    detailFanOut = await fanOutDetails(token, resource, filtered);
  }

  return {
    resource,
    status: "success",
    chosenEndpoint: chosen,
    endpointAttempts: attempts,
    contractValidation: contract,
    rows: filtered.map((r) => sanitize(r)),
    matchedRawRows: filtered,
    totalReported: reportedTotal,
    fetched: deduped.length,
    matched: filtered.length,
    pagesFetched: pages,
    truncated,
    elapsedMs: Date.now() - startedAll,
    mafLabel: "Live N3 Confirmed",
    filterDiagnostic: diagnostic,
    detailFanOut,
  };
}

// ---- Run orchestrator ----------------------------------------------------

export type FinancialVerificationRun = {
  schemaVersion: string;
  runId: string;
  runAt: string;
  dateFrom: string;
  dateTo: string;
  tenant: { id: string | null; code: string | null; name: string | null };
  filters: NormalizedFilters;
  resources: ResourceReport[];
  elapsedMs: number;
};

function makeRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
  return `${ts}-${rand}`;
}

export async function runFinancialVerification(input: {
  token: string;
  dateFrom: string;
  dateTo: string;
  tenant: { id: string | null; code: string | null; name: string | null };
  filters?: NormalizedFilters;
  tenantCustomer?: { code: string | null } | null;
}): Promise<FinancialVerificationRun> {
  const started = Date.now();
  const filters = normalizeFilters(input.filters);
  const tc = input.tenantCustomer ?? null;
  const resources = await Promise.all([
    fetchListResource(input.token, "ar_receipts", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "cash_sales", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "customer_refunds", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "gl_accounts", input.dateFrom, input.dateTo, filters, tc),
  ]);
  return {
    schemaVersion: FINANCIAL_BUNDLE_SCHEMA_VERSION,
    runId: makeRunId(),
    runAt: new Date().toISOString(),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    tenant: input.tenant,
    filters,
    resources,
    elapsedMs: Date.now() - started,
  };
}

// ---- GL eligibility (strict) ---------------------------------------------

export type GlEligibility = "bank" | "cash" | "unknown" | "ineligible";

export type GlEligibilityDetail = {
  eligibility: GlEligibility;
  reasons: string[];
  normalizedSpecialType: string | null;
  active: boolean | null;
  posting: boolean | null;
  hasImmutableId: boolean;
};

function normalizeSpecialType(v: unknown): string | null {
  const s = normStr(v);
  if (!s) return null;
  return s.replace(/\s+/g, " ").trim();
}

export function evaluateGlAccount(row: unknown): GlEligibilityDetail {
  const reasons: string[] = [];
  if (!isPlainObject(row)) {
    return {
      eligibility: "unknown",
      reasons: ["row_not_object"],
      normalizedSpecialType: null,
      active: null,
      posting: null,
      hasImmutableId: false,
    };
  }
  const hasImmutableId = !!rowId(row);
  if (!hasImmutableId) reasons.push("missing_immutable_id");

  const specialRaw = pick(row, ["SpecialType", "specialType", "SpecialAccountType"]);
  const normalizedSpecialType = normalizeSpecialType(specialRaw);

  const active = toBool(pick(row, ["Active", "active", "IsActive", "isActive", "Enabled", "enabled"]));
  if (active === null) reasons.push("missing_active_flag");
  else if (active === false) reasons.push("account_inactive");

  const posting = toBool(
    pick(row, [
      "IsPostingAccount",
      "isPostingAccount",
      "Posting",
      "posting",
      "IsLeaf",
      "isLeaf",
      "Leaf",
      "leaf",
      "IsDetail",
      "isDetail",
    ]),
  );
  if (posting === null) reasons.push("missing_posting_or_leaf_flag");
  else if (posting === false) reasons.push("account_not_posting");

  if (!normalizedSpecialType) reasons.push("missing_special_type");

  const st = normalizedSpecialType?.toLowerCase() ?? "";
  const isBankSpecial = st === "bank account" || st === "bank";
  const isCashSpecial = st === "cash account" || st === "cash" || st === "petty cash";

  if (hasImmutableId && active === true && posting === true && isBankSpecial) {
    return {
      eligibility: "bank",
      reasons: ["special_type_bank", "active", "posting"],
      normalizedSpecialType,
      active,
      posting,
      hasImmutableId,
    };
  }
  if (hasImmutableId && active === true && posting === true && isCashSpecial) {
    return {
      eligibility: "cash",
      reasons: ["special_type_cash", "active", "posting"],
      normalizedSpecialType,
      active,
      posting,
      hasImmutableId,
    };
  }
  // If SpecialType is present and clearly non-bank/non-cash, mark ineligible.
  if (normalizedSpecialType && !isBankSpecial && !isCashSpecial) {
    return {
      eligibility: "ineligible",
      reasons: [...reasons, "special_type_not_bank_or_cash"],
      normalizedSpecialType,
      active,
      posting,
      hasImmutableId,
    };
  }
  return {
    eligibility: "unknown",
    reasons,
    normalizedSpecialType,
    active,
    posting,
    hasImmutableId,
  };
}

// Backward-compat: existing callers/tests import `classifyGlAccount` and
// expect a simple enum value. The corrected semantics use `evaluateGlAccount`
// and demote name-only or missing-flag rows to `unknown`.
export function classifyGlAccount(row: unknown): GlEligibility {
  return evaluateGlAccount(row).eligibility;
}

// ---- OR knockoffs (parsing + comparison) ---------------------------------

export type ParsedKnockoff = {
  docType: string | null; // original casing preserved
  docTypeNormalized: string | null; // uppercased trimmed
  docId: string | null;
  docNo: string | null;
  docCode: string | null;
  appliedAmount: number | null;
  raw: Record<string, unknown>;
};

function extractKnockoffs(row: Record<string, unknown>): ParsedKnockoff[] {
  // Singular `knockoff` field is the documented live shape.
  const singular = pick(row, ["knockoff", "Knockoff", "KnockOff", "knockOff"]);
  const plural = pick(row, ["knockoffs", "Knockoffs", "KnockOffs", "knockOffs"]);
  const raws: unknown[] = [];
  if (isPlainObject(singular)) raws.push(singular);
  else if (Array.isArray(singular)) raws.push(...singular);
  if (Array.isArray(plural)) raws.push(...plural);
  else if (isPlainObject(plural)) raws.push(plural);

  const parsed: ParsedKnockoff[] = [];
  for (const k of raws) {
    if (!isPlainObject(k)) continue;
    const docType = normStr(pick(k, ["DocType", "docType", "Type", "type"]));
    const docId = normStr(pick(k, ["DocId", "docId", "DocumentId", "documentId"]));
    const docNo = normStr(pick(k, ["DocNo", "docNo", "DocumentNo", "documentNo"]));
    const docCode = normStr(pick(k, ["DocCode", "docCode", "DocumentCode", "documentCode"]));
    const appliedAmount = toNumber(
      pick(k, ["AppliedAmount", "appliedAmount", "Amount", "amount", "PaidAmount", "paidAmount"]),
    );
    parsed.push({
      docType,
      docTypeNormalized: docType ? docType.trim().toUpperCase() : null,
      docId,
      docNo,
      docCode,
      appliedAmount,
      raw: k,
    });
  }
  return parsed;
}

// Compare an OR's knockoff row to the Cash Sales row it should point at.
export type KnockoffMatch = {
  receiptId: string | null;
  receiptDocNo: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  docCode: string | null;
  appliedAmount: number | null;
  candidateCashSalesId: string | null;
  candidateCashSalesDocNo: string | null;
  candidateCashSalesDocCode: string | null;
  sameUuid: boolean | null;
  customerMatch: boolean | null;
  // Correlation labels kept backward-compatible with the previous UI/tests.
  correlation: "immutable_id" | "document_number_only" | "mismatch" | "not_available" | "none";
  evidenceLabel:
    | "Immutable ID confirmed"
    | "Document-number only — not proven"
    | "Mismatch"
    | "Not available";
};

function customerIdOf(row: Record<string, unknown>): string | null {
  return normStr(pick(row, ["CustomerId", "customerId", "DebtorId", "debtorId"]));
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
    const docNo = normStr(pick(raw, ["DocNo", "docNo"]));
    if (id) csById.set(id.toUpperCase(), raw);
    if (docNo) csByDocNo.set(docNo.toUpperCase(), raw);
  }
  const out: KnockoffMatch[] = [];
  for (const rec of arReceipts) {
    if (!isPlainObject(rec)) continue;
    const receiptId = rowId(rec);
    const receiptDocNo = normStr(pick(rec, ["DocNo", "docNo"]));
    const receiptCustomer = customerIdOf(rec);
    for (const k of extractKnockoffs(rec)) {
      // Only INV-type knockoffs correlate to Cash Sales / Cash Memos.
      if (k.docTypeNormalized !== "INV") continue;
      const byId = k.docId ? csById.get(k.docId.toUpperCase()) : undefined;
      const byNo = !byId && k.docNo ? csByDocNo.get(k.docNo.toUpperCase()) : undefined;
      const cs = byId ?? byNo ?? null;
      const csId = cs ? rowId(cs) : null;
      const csDocNo = cs ? normStr(pick(cs, ["DocNo", "docNo"])) : null;
      const csDocCode = cs ? normStr(pick(cs, ["DocCode", "docCode"])) : null;
      const csCustomer = cs ? customerIdOf(cs) : null;
      const sameUuid =
        k.docId && csId ? k.docId.toUpperCase() === csId.toUpperCase() : null;
      const customerMatch =
        receiptCustomer && csCustomer
          ? receiptCustomer.toUpperCase() === csCustomer.toUpperCase()
          : null;

      let correlation: KnockoffMatch["correlation"];
      let evidenceLabel: KnockoffMatch["evidenceLabel"];
      if (byId) {
        correlation = "immutable_id";
        evidenceLabel = "Immutable ID confirmed";
      } else if (k.docId && csId && k.docId.toUpperCase() !== csId.toUpperCase()) {
        correlation = "mismatch";
        evidenceLabel = "Mismatch";
      } else if (byNo) {
        correlation = "document_number_only";
        evidenceLabel = "Document-number only — not proven";
      } else {
        correlation = "not_available";
        evidenceLabel = "Not available";
      }

      out.push({
        receiptId,
        receiptDocNo,
        docType: k.docType,
        docId: k.docId,
        docNo: k.docNo,
        docCode: k.docCode,
        appliedAmount: k.appliedAmount,
        candidateCashSalesId: csId,
        candidateCashSalesDocNo: csDocNo,
        candidateCashSalesDocCode: csDocCode,
        sameUuid,
        customerMatch,
        correlation,
        evidenceLabel,
      });
    }
  }
  return out;
}

// ---- OR origin classification --------------------------------------------

export type OrClassification = "ar_receipt" | "gl_originated_or" | "unknown";

export function classifyOrOrigin(row: unknown): OrClassification {
  if (!isPlainObject(row)) return "unknown";
  const source = pick(row, ["Source", "source", "OriginModule", "originModule", "FromModule", "fromModule"]);
  const s = String(source ?? "").toLowerCase();
  if (s.includes("gl") || s.includes("journal")) return "gl_originated_or";
  const customer = pick(row, ["CustomerId", "customerId", "DebtorId", "debtorId", "CustomerCode", "customerCode"]);
  const hasKnockoff = extractKnockoffs(row).length > 0;
  if (customer && (hasKnockoff || customer)) return "ar_receipt";
  return "unknown";
}

// ---- Customer Refund → OR comparison --------------------------------------

export type RefundKnockoffMatch = {
  refundId: string | null;
  refundDocNo: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  docCode: string | null;
  appliedAmount: number | null;
  candidateReceiptId: string | null;
  candidateReceiptDocNo: string | null;
  sameUuid: boolean | null;
  customerMatch: boolean | null;
  correlation: "immutable_id" | "document_number_only" | "mismatch" | "not_available";
  evidenceLabel:
    | "Immutable ID confirmed"
    | "Document-number only — not proven"
    | "Mismatch"
    | "Not available";
};

export function compareRefundKnockoffs(
  customerRefunds: unknown[],
  arReceipts: unknown[],
): RefundKnockoffMatch[] {
  const orById = new Map<string, Record<string, unknown>>();
  const orByDocNo = new Map<string, Record<string, unknown>>();
  for (const raw of arReceipts) {
    if (!isPlainObject(raw)) continue;
    const id = rowId(raw);
    const docNo = normStr(pick(raw, ["DocNo", "docNo"]));
    if (id) orById.set(id.toUpperCase(), raw);
    if (docNo) orByDocNo.set(docNo.toUpperCase(), raw);
  }
  const out: RefundKnockoffMatch[] = [];
  for (const rf of customerRefunds) {
    if (!isPlainObject(rf)) continue;
    const refundId = rowId(rf);
    const refundDocNo = normStr(pick(rf, ["DocNo", "docNo"]));
    const refundCustomer = customerIdOf(rf);
    for (const k of extractKnockoffs(rf)) {
      // Refunds knock off OR receipts. Accept either the "OR" type marker
      // when present or fall back on any docId/docNo the payload provides.
      if (k.docTypeNormalized && !["OR", "RECEIPT", "AR"].includes(k.docTypeNormalized)) continue;
      const byId = k.docId ? orById.get(k.docId.toUpperCase()) : undefined;
      const byNo = !byId && k.docNo ? orByDocNo.get(k.docNo.toUpperCase()) : undefined;
      const or = byId ?? byNo ?? null;
      const orId = or ? rowId(or) : null;
      const orDocNo = or ? normStr(pick(or, ["DocNo", "docNo"])) : null;
      const orCustomer = or ? customerIdOf(or) : null;
      const sameUuid = k.docId && orId ? k.docId.toUpperCase() === orId.toUpperCase() : null;
      const customerMatch =
        refundCustomer && orCustomer
          ? refundCustomer.toUpperCase() === orCustomer.toUpperCase()
          : null;

      let correlation: RefundKnockoffMatch["correlation"];
      let evidenceLabel: RefundKnockoffMatch["evidenceLabel"];
      if (byId) {
        correlation = "immutable_id";
        evidenceLabel = "Immutable ID confirmed";
      } else if (k.docId && orId && k.docId.toUpperCase() !== orId.toUpperCase()) {
        correlation = "mismatch";
        evidenceLabel = "Mismatch";
      } else if (byNo) {
        correlation = "document_number_only";
        evidenceLabel = "Document-number only — not proven";
      } else {
        correlation = "not_available";
        evidenceLabel = "Not available";
      }

      out.push({
        refundId,
        refundDocNo,
        docType: k.docType,
        docId: k.docId,
        docNo: k.docNo,
        docCode: k.docCode,
        appliedAmount: k.appliedAmount,
        candidateReceiptId: orId,
        candidateReceiptDocNo: orDocNo,
        sameUuid,
        customerMatch,
        correlation,
        evidenceLabel,
      });
    }
  }
  return out;
}

// ---- Source-field maps (for the evidence bundle) -------------------------

export function buildFieldMap(rows: unknown[]): Record<string, string[]> {
  return { observed: unionKeys(rows, 8) };
}
