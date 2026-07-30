// Server-only N3 Financial Verification helpers — Run 5D0.3 Critical
// Correction. READ-ONLY. Only authenticated GETs are permitted here.
//
// Discipline (5d0.3):
//   • Every candidate endpoint tried is recorded with an ALLOWLISTED public
//     shape. `rawItems`, `rawTotal`, `body`, `matchedRawRows` and any other
//     internal properties MUST NOT reach the browser or the exported bundle.
//   • Semantic validation runs INSIDE the candidate loop. A 2xx that fails
//     semantic validation is recorded as `Mismatch` and the loop continues to
//     the next candidate.
//   • An empty page cannot establish `Live N3 Confirmed` on its own for
//     resources whose envelope message identifies a different resource
//     (e.g. AR/Sales Credit Note vs Customer Refund).
//   • GL lookup tries `/api/AccountCodes/Leaf/Query` first (proven working
//     in mugs-AI/n3-custom-bill-entry), then falls back to
//     `/api/GLAccounts/Query` and `/api/glaccounts/list`.
//   • Detail fan-out normalises the inner detail DTO. Raw DTOs stay
//     server-only; normalised DTOs drive comparisons.
//   • Comparisons cross-check BOTH immutable ID and document number:
//     ID resolves but docNo disagrees → Mismatch.

import { callN3Path } from "./n3-gateway.server";

export const FINANCIAL_BUNDLE_SCHEMA_VERSION = "5d0.3";

export type FinResource = "ar_receipts" | "cash_sales" | "customer_refunds" | "gl_accounts";

export type MafLabel =
  | "Documented Contract"
  | "Live N3 Confirmed"
  | "Desktop Supporting Evidence"
  | "Inference"
  | "Not Available"
  | "Mismatch";

export type FetchStatus =
  "success" | "unavailable" | "unauthorized" | "invalid_contract" | "failed";

const RESOURCE_CANDIDATES: Record<FinResource, string[]> = {
  ar_receipts: ["/api/arreceipts/list", "/api/arreceive/list"],
  cash_sales: ["/api/cashsales/list"],
  customer_refunds: ["/api/customerrefunds/list", "/api/debtorrefund/list"],
  // /api/AccountCodes/Leaf/Query is the proven working GL lookup (see
  // mugs-AI/n3-custom-bill-entry). The GLAccounts endpoints observed 404
  // in the live 5d0.2 bundle, but we keep them as ordered fallbacks so a
  // future N3 release that exposes them is still detected.
  gl_accounts: ["/api/AccountCodes/Leaf/Query", "/api/GLAccounts/Query", "/api/glaccounts/list"],
};

const RESOURCE_DETAIL_ROOT: Record<Exclude<FinResource, "gl_accounts">, string> = {
  ar_receipts: "/api/arreceipts",
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
  if (typeof from !== "string" || !isoRe.test(from))
    return { ok: false, error: "date_from_invalid" };
  if (typeof to !== "string" || !isoRe.test(to)) return { ok: false, error: "date_to_invalid" };
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return { ok: false, error: "date_invalid" };
  if (t < f) return { ok: false, error: "date_to_before_from" };
  const days = Math.floor((t - f) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: "date_range_exceeds_31_days" };
  return { ok: true, from, to };
}

// ---- Sanitizer (case-insensitive, recursive) -----------------------------

const REDACT_KEYS = new Set([
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

// Recursive assertion helper — used by tests and by the server before
// returning any bundle to the browser. Throws on any forbidden property or
// value in the JSON tree.
const FORBIDDEN_KEYS = new Set([
  "rawitems",
  "rawtotal",
  "body",
  "matchedrawrows",
  "_matcheddetaildtos",
  "authorization",
  "bearer",
  "cookie",
  "token",
  "apikey",
  "api_key",
]);

export function assertNoInternalOrSecretFields(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      assertNoInternalOrSecretFields(value[i], `${path}[${i}]`);
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        throw new Error(`bundle_contains_forbidden_key:${path}.${k}`);
      }
      // Refuse tenant UUIDs in exported bundles. Tenant id lives only in
      // audit logs; the bundle carries `code` + `name` only.
      if (k.toLowerCase() === "tenant" && isPlainObject(v)) {
        for (const tk of Object.keys(v)) {
          if (tk.toLowerCase() === "id" && v[tk] !== null && v[tk] !== undefined) {
            throw new Error(`bundle_contains_tenant_id:${path}.${k}.${tk}`);
          }
        }
      }
      assertNoInternalOrSecretFields(v, `${path}.${k}`);
    }
  }
}

// ---- Envelope helpers -----------------------------------------------------

export type EndpointAttempt = {
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

type InternalCall = {
  attempt: EndpointAttempt;
  rawItems: unknown[] | null;
  rawTotal: number | null;
  body: unknown;
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
  const v = body.value ?? body.Value ?? body.items ?? body.Items ?? body.results ?? body.Results;
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

async function callOnce(token: string, path: string): Promise<InternalCall> {
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
      attempt: {
        endpoint: pathOnly,
        method: "GET",
        query,
        httpStatus: res.status,
        envelopeCode: env.code,
        envelopeMessage: env.message,
        durationMs: Date.now() - started,
        timestamp,
        responseSample: sanitize(res.body),
      },
      rawItems: items,
      rawTotal: total,
      body: res.body,
    };
  } catch (err) {
    return {
      attempt: {
        endpoint: pathOnly,
        method: "GET",
        query,
        httpStatus: null,
        envelopeCode: null,
        envelopeMessage: null,
        durationMs: Date.now() - started,
        timestamp,
        responseSample: null,
        error: (err as Error).message?.slice(0, 200) ?? "network_error",
      },
      rawItems: null,
      rawTotal: null,
      body: null,
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
  observedFields: string[];
  requiredHits: Record<string, boolean>;
  suspectedResource: FinResource | "ar_credit_note" | "sales_credit_note" | "unknown" | null;
  reason: string;
  envelopeMessage?: string | null;
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

function envelopeIdentifiesCreditNote(message: string | null): boolean {
  if (!message) return false;
  return /credit\s*note/i.test(message);
}

function envelopeIdentifiesSalesCreditNote(message: string | null): boolean {
  return !!message && /sales\s*credit\s*note/i.test(message);
}

export function validateContract(
  resource: FinResource,
  rows: unknown[],
  envelopeMessage: string | null = null,
): ContractValidation {
  const obs = unionKeys(rows);
  switch (resource) {
    case "ar_receipts": {
      // Live list rows do NOT need to expose knockoff/deposit — those live
      // in the detail DTO. Strong list signals: doc identity + customer.
      const hasCustomer = hasAnyKey(obs, [
        "CustomerId",
        "customerId",
        "DebtorId",
        "debtorId",
        "CustomerCode",
        "customerCode",
        "DebtorCode",
        "debtorCode",
        "Customer",
        "customer",
        "CustomerName",
        "customerName",
      ]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const hasAmount = hasAnyKey(obs, [
        "Total",
        "total",
        "TotalAmount",
        "totalAmount",
        "PaidAmount",
        "paidAmount",
        "ReceivedAmount",
        "receivedAmount",
        "Amount",
        "amount",
        "NetTotalAmount",
        "netTotalAmount",
      ]);
      const looksReceipt = envelopeMessage ? /receipt|receive/i.test(envelopeMessage) : false;
      // An empty page CANNOT establish Live N3 Confirmed on its own.
      const passed = rows.length > 0 && hasDoc && hasCustomer && hasAmount;
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasCustomer, hasDoc, hasAmount, looksReceipt, isEmpty: rows.length === 0 },
        suspectedResource: passed
          ? "ar_receipts"
          : envelopeIdentifiesCreditNote(envelopeMessage)
            ? "ar_credit_note"
            : "unknown",
        reason:
          rows.length === 0
            ? "empty_page_cannot_prove_ar_receipts"
            : passed
              ? "ar_receipt_fields_present"
              : "missing_ar_receipt_signals",
        envelopeMessage,
      };
    }
    case "cash_sales": {
      // Live shape observed: customer, customerName, netTotalAmount,
      // outstandingAmount, isPostToAR, referenceNo.
      const hasCustomer = hasAnyKey(obs, [
        "CustomerId",
        "customerId",
        "DebtorId",
        "debtorId",
        "CustomerCode",
        "customerCode",
        "Customer",
        "customer",
        "CustomerName",
        "customerName",
      ]);
      const hasTotal = hasAnyKey(obs, [
        "Total",
        "total",
        "NetTotal",
        "netTotal",
        "NetTotalAmount",
        "netTotalAmount",
        "GrandTotal",
        "grandTotal",
      ]);
      const hasIsPostToAR = hasAnyKey(obs, ["IsPostToAR", "isPostToAR", "PostToAR", "postToAR"]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const strong = hasDoc && (hasIsPostToAR || (hasCustomer && hasTotal));
      // Empty page cannot establish Live N3 Confirmed.
      const passed = rows.length > 0 && strong;
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasCustomer, hasTotal, hasDoc, hasIsPostToAR, isEmpty: rows.length === 0 },
        suspectedResource: passed
          ? "cash_sales"
          : envelopeIdentifiesSalesCreditNote(envelopeMessage)
            ? "sales_credit_note"
            : "unknown",
        reason:
          rows.length === 0
            ? "empty_page_cannot_prove_cash_sales"
            : passed
              ? "cash_sales_fields_present"
              : "missing_cash_sales_signals",
        envelopeMessage,
      };
    }
    case "customer_refunds": {
      // 5d0.3B: N3 reuses a misleading envelope message
      // ("Get AR credit note list success") for the genuine
      // /api/customerrefunds/list resource. Proof of resource identity is
      // therefore STRUCTURAL: an explicit `RF` transaction discriminator.
      // Empty page can never prove Customer Refund, regardless of envelope.
      if (rows.length === 0) {
        return {
          passed: false,
          observedFields: obs,
          requiredHits: { isEmpty: true },
          suspectedResource: envelopeIdentifiesCreditNote(envelopeMessage)
            ? envelopeIdentifiesSalesCreditNote(envelopeMessage)
              ? "sales_credit_note"
              : "ar_credit_note"
            : "unknown",
          reason: "empty_page_cannot_prove_customer_refund",
          envelopeMessage,
        };
      }
      const docTypes = rows
        .filter(isPlainObject)
        .map((r) =>
          normStr(pick(r as Record<string, unknown>, ["docType", "DocType", "documentType", "DocumentType"])),
        )
        .filter((v): v is string => !!v)
        .map((v) => v.toUpperCase());
      const hasRfDocType = docTypes.includes("RF");
      const foreignDocTypes = Array.from(new Set(docTypes.filter((t) => t !== "RF")));

      const hasId = hasAnyKey(obs, ["Id", "id", "Guid", "guid"]);
      const hasDoc = hasAnyKey(obs, ["DocNo", "docNo", "DocCode", "docCode"]);
      const hasCustomer =
        hasAnyKey(obs, [
          "CustomerId",
          "customerId",
          "DebtorId",
          "debtorId",
          "CustomerCode",
          "customerCode",
          "DebtorCode",
          "debtorCode",
        ]) ||
        rows.filter(isPlainObject).some((r) => {
          const c = (r as Record<string, unknown>).customer ?? (r as Record<string, unknown>).Customer;
          return (
            isPlainObject(c) && (!!normStr(pick(c, ["Id", "id"])) || !!normStr(pick(c, ["Code", "code"])))
          );
        });
      const hasAmount = rows.filter(isPlainObject).some((r) => {
        const v = pick(r as Record<string, unknown>, [
          "NetTotalAmount",
          "netTotalAmount",
          "TotalAmount",
          "totalAmount",
          "Amount",
          "amount",
          "Total",
          "total",
        ]);
        return toNumber(v) !== null;
      });
      const hasAccount = hasAnyKey(obs, ["Account", "account", "PaymentBy", "paymentBy", "PayFrom", "payFrom"]);

      const passed = hasRfDocType && hasId && hasDoc && hasCustomer && hasAmount;
      return {
        passed,
        observedFields: obs,
        requiredHits: {
          hasRfDocType,
          hasId,
          hasDoc,
          hasCustomer,
          hasAmount,
          hasAccount,
          isEmpty: false,
          envelopeMentionsCreditNote: envelopeIdentifiesCreditNote(envelopeMessage),
        },
        suspectedResource: passed
          ? "customer_refunds"
          : foreignDocTypes.length || envelopeIdentifiesCreditNote(envelopeMessage)
            ? envelopeIdentifiesSalesCreditNote(envelopeMessage) ||
              foreignDocTypes.some((t) => t === "SCN")
              ? "sales_credit_note"
              : "ar_credit_note"
            : "unknown",
        reason: passed
          ? "customer_refund_rf_structure_confirmed"
          : hasRfDocType
            ? "missing_customer_refund_signals"
            : foreignDocTypes.length
              ? "non_rf_document_type_rejected_as_refund"
              : "missing_rf_document_type_discriminator",
        envelopeMessage,
      };
    }

    case "gl_accounts": {
      const hasSpecial = hasAnyKey(obs, ["SpecialType", "specialType", "SpecialAccountType"]);
      const hasName = hasAnyKey(obs, [
        "Name",
        "name",
        "AccountName",
        "accountName",
        "Description",
        "description",
      ]);
      const hasCode = hasAnyKey(obs, ["Code", "code", "AccountCode", "accountCode"]);
      // Empty page cannot establish Live N3 Confirmed.
      const passed = rows.length > 0 && hasName && hasCode;
      return {
        passed,
        observedFields: obs,
        requiredHits: { hasSpecial, hasName, hasCode, isEmpty: rows.length === 0 },
        suspectedResource: passed ? "gl_accounts" : "unknown",
        reason:
          rows.length === 0
            ? "empty_page_cannot_prove_gl_accounts"
            : passed
              ? "gl_account_fields_present"
              : "missing_gl_account_signals",
        envelopeMessage,
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
  mismatches: string[];
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
  // Live Cash Sales exposes the customer CODE as `customer`/`Customer`
  // (a plain string). Never accept `customerName` as a code — it is a
  // display value and can never establish an exact-code match.
  "Customer",
  "customer",
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

  if (resource === "gl_accounts" || Object.keys(filters).length === 0) {
    return { rows, diagnostic };
  }

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
    if (filters.docNumber && !DOC_NUMBER_FIELDS.some((f) => eq(r[f], filters.docNumber!)))
      return false;
    if (filters.hotelReference && !HOTEL_REF_FIELDS.some((f) => eq(r[f], filters.hotelReference!)))
      return false;
    if (filters.customerCode && !CUSTOMER_CODE_FIELDS.some((f) => eq(r[f], filters.customerCode!)))
      return false;
    return true;
  });

  diagnostic.afterCount = kept.length;
  return { rows: kept, diagnostic };
}

// ---- Normalised detail DTOs ----------------------------------------------

export type NormalizedReceipt = {
  id: string | null;
  docNo: string | null;
  docCode: string | null;
  customerId: string | null;
  customerCode: string | null;
  totalAmount: number | null;
  knockoffs: ParsedKnockoff[];
  sourceFields: Record<string, string>;
};

export type NormalizedCashSale = {
  id: string | null;
  docNo: string | null;
  docCode: string | null;
  customerId: string | null;
  customerCode: string | null;
  netTotalAmount: number | null;
  outstandingAmount: number | null;
  isPostToAR: boolean | null;
  referenceNo: string | null;
  sourceFields: Record<string, string>;
};

export type NormalizedRefundAccount = {
  id: string | null;
  code: string | null;
  name: string | null;
  type: string | null;
  specialCode: string | null;
  isActive: boolean | null;
};

export type NormalizedRefund = {
  id: string | null;
  docNo: string | null;
  docCode: string | null;
  docDate: string | null;
  docType: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  description: string | null;
  referenceNo: string | null;
  amount: number | null;
  netTotalAmount: number | null;
  outstandingAmount: number | null;
  status: string | null;
  isCancelled: boolean | null;
  currencyCode: string | null;
  account: NormalizedRefundAccount | null;
  knockoffs: ParsedKnockoff[];
  sourceFields: Record<string, string>;
};


function pickWithField(
  row: Record<string, unknown>,
  keys: string[],
): { value: unknown; field: string | null } {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return { value: row[k], field: k };
  }
  return { value: undefined, field: null };
}

// Extract the inner detail DTO from a detail envelope.
function innerDetailOf(body: unknown): Record<string, unknown> | null {
  if (isPlainObject(body)) {
    const data = body.data ?? body.Data;
    if (isPlainObject(data)) {
      // Some N3 detail endpoints wrap the DTO as { data: { value: {...} } }.
      const value = data.value ?? data.Value;
      if (isPlainObject(value)) return value;
      if (Array.isArray(value) && value.length > 0 && isPlainObject(value[0])) return value[0];
      return data;
    }
    if (Array.isArray(data) && data.length > 0 && isPlainObject(data[0])) return data[0];
    // Some N3 endpoints return the DTO at the top level.
    return body;
  }
  return null;
}

export function normalizeReceiptDetail(body: unknown): NormalizedReceipt | null {
  const dto = innerDetailOf(body);
  if (!dto) return null;
  const src: Record<string, string> = {};
  const id = normStr(pick(dto, ["Id", "id"]));
  if (id) src.id = "Id";
  const dn = pickWithField(dto, ["DocNo", "docNo"]);
  if (dn.field) src.docNo = dn.field;
  const dc = pickWithField(dto, ["DocCode", "docCode"]);
  if (dc.field) src.docCode = dc.field;
  const ci = pickWithField(dto, ["CustomerId", "customerId", "DebtorId", "debtorId"]);
  if (ci.field) src.customerId = ci.field;
  const cc = pickWithField(dto, ["CustomerCode", "customerCode", "DebtorCode", "debtorCode"]);
  if (cc.field) src.customerCode = cc.field;
  const total = pickWithField(dto, [
    "Total",
    "total",
    "TotalAmount",
    "totalAmount",
    "PaidAmount",
    "paidAmount",
    "ReceivedAmount",
    "receivedAmount",
    "NetTotalAmount",
    "netTotalAmount",
  ]);
  if (total.field) src.totalAmount = total.field;
  return {
    id,
    docNo: normStr(dn.value),
    docCode: normStr(dc.value),
    customerId: normStr(ci.value),
    customerCode: normStr(cc.value),
    totalAmount: toNumber(total.value),
    knockoffs: extractKnockoffs(dto),
    sourceFields: src,
  };
}

export function normalizeCashSaleDetail(body: unknown): NormalizedCashSale | null {
  const dto = innerDetailOf(body);
  if (!dto) return null;
  const src: Record<string, string> = {};
  const id = normStr(pick(dto, ["Id", "id"]));
  if (id) src.id = "Id";
  const dn = pickWithField(dto, ["DocNo", "docNo"]);
  if (dn.field) src.docNo = dn.field;
  const dc = pickWithField(dto, ["DocCode", "docCode"]);
  if (dc.field) src.docCode = dc.field;
  const ci = pickWithField(dto, ["CustomerId", "customerId", "DebtorId", "debtorId"]);
  if (ci.field) src.customerId = ci.field;
  const cc = pickWithField(dto, ["CustomerCode", "customerCode", "DebtorCode", "debtorCode"]);
  if (cc.field) src.customerCode = cc.field;
  const nt = pickWithField(dto, [
    "NetTotalAmount",
    "netTotalAmount",
    "NetTotal",
    "netTotal",
    "Total",
    "total",
  ]);
  if (nt.field) src.netTotalAmount = nt.field;
  const outs = pickWithField(dto, ["OutstandingAmount", "outstandingAmount"]);
  if (outs.field) src.outstandingAmount = outs.field;
  const pa = pickWithField(dto, ["IsPostToAR", "isPostToAR", "PostToAR", "postToAR"]);
  if (pa.field) src.isPostToAR = pa.field;
  const ref = pickWithField(dto, ["ReferenceNo", "referenceNo", "Reference", "reference"]);
  if (ref.field) src.referenceNo = ref.field;
  return {
    id,
    docNo: normStr(dn.value),
    docCode: normStr(dc.value),
    customerId: normStr(ci.value),
    customerCode: normStr(cc.value),
    netTotalAmount: toNumber(nt.value),
    outstandingAmount: toNumber(outs.value),
    isPostToAR: toBool(pa.value),
    referenceNo: normStr(ref.value),
    sourceFields: src,
  };
}

export function normalizeRefundDetail(body: unknown): NormalizedRefund | null {
  const dto = innerDetailOf(body);
  if (!dto) return null;
  const src: Record<string, string> = {};
  const id = normStr(pick(dto, ["Id", "id"]));
  if (id) src.id = "Id";
  const dn = pickWithField(dto, ["DocNo", "docNo"]);
  if (dn.field) src.docNo = dn.field;
  const dc = pickWithField(dto, ["DocCode", "docCode"]);
  if (dc.field) src.docCode = dc.field;
  const ci = pickWithField(dto, ["CustomerId", "customerId", "DebtorId", "debtorId"]);
  if (ci.field) src.customerId = ci.field;
  const cc = pickWithField(dto, ["CustomerCode", "customerCode", "DebtorCode", "debtorCode"]);
  if (cc.field) src.customerCode = cc.field;
  const amt = pickWithField(dto, [
    "Amount",
    "amount",
    "NetTotalAmount",
    "netTotalAmount",
    "TotalAmount",
    "totalAmount",
    "Total",
    "total",
  ]);
  if (amt.field) src.amount = amt.field;
  const dd = pickWithField(dto, ["DocDate", "docDate", "Date", "date"]);
  if (dd.field) src.docDate = dd.field;
  const dt = pickWithField(dto, ["DocType", "docType", "DocumentType", "documentType"]);
  if (dt.field) src.docType = dt.field;
  const cn = pickWithField(dto, ["CustomerName", "customerName", "DebtorName", "debtorName"]);
  if (cn.field) src.customerName = cn.field;
  const desc = pickWithField(dto, ["Description", "description"]);
  if (desc.field) src.description = desc.field;
  const ref = pickWithField(dto, ["ReferenceNo", "referenceNo", "Reference", "reference"]);
  if (ref.field) src.referenceNo = ref.field;
  const nt = pickWithField(dto, ["NetTotalAmount", "netTotalAmount"]);
  if (nt.field) src.netTotalAmount = nt.field;
  const outs = pickWithField(dto, ["OutstandingAmount", "outstandingAmount"]);
  if (outs.field) src.outstandingAmount = outs.field;
  const st = pickWithField(dto, ["Status", "status"]);
  if (st.field) src.status = st.field;
  const canc = pickWithField(dto, ["IsCancelled", "isCancelled", "Cancelled", "cancelled"]);
  if (canc.field) src.isCancelled = canc.field;
  const cur = pickWithField(dto, ["CurrencyCode", "currencyCode"]);
  if (cur.field) src.currencyCode = cur.field;

  // Customer object (customer.id / customer.code / customer.name)
  const custObj = pickWithField(dto, ["Customer", "customer"]);
  let customerId = normStr(ci.value);
  let customerCode = normStr(cc.value);
  let customerName = normStr(cn.value);
  if (isPlainObject(custObj.value)) {
    const c = custObj.value;
    customerId = customerId ?? normStr(pick(c, ["Id", "id"]));
    customerCode = customerCode ?? normStr(pick(c, ["Code", "code"]));
    customerName = customerName ?? normStr(pick(c, ["Name", "name"]));
    if (custObj.field) src.customer = custObj.field;
  } else if (typeof custObj.value === "string") {
    customerCode = customerCode ?? normStr(custObj.value);
    if (custObj.field) src.customer = custObj.field;
  }

  // Payment-By account object
  const acctRaw = pickWithField(dto, ["Account", "account", "PaymentBy", "paymentBy", "PayFrom", "payFrom"]);
  let account: NormalizedRefundAccount | null = null;
  if (isPlainObject(acctRaw.value)) {
    const a = acctRaw.value;
    account = {
      id: normStr(pick(a, ["Id", "id"])),
      code: normStr(pick(a, ["Code", "code"])),
      name: normStr(pick(a, ["Name", "name"])),
      type: normStr(pick(a, ["Type", "type"])),
      specialCode: normStr(pick(a, ["SpecialCode", "specialCode"])),
      isActive: toBool(pick(a, ["IsActive", "isActive"])),
    };
    if (acctRaw.field) src.account = acctRaw.field;
  }

  return {
    id,
    docNo: normStr(dn.value),
    docCode: normStr(dc.value),
    docDate: normStr(dd.value),
    docType: normStr(dt.value),
    customerId,
    customerCode,
    customerName,
    description: normStr(desc.value),
    referenceNo: normStr(ref.value),
    amount: toNumber(amt.value),
    netTotalAmount: toNumber(nt.value),
    outstandingAmount: toNumber(outs.value),
    status: normStr(st.value),
    isCancelled: toBool(canc.value),
    currencyCode: normStr(cur.value),
    account,
    knockoffs: extractKnockoffs(dto),
    sourceFields: src,
  };
}


type NormalizedTransactionDetail = NormalizedReceipt | NormalizedCashSale | NormalizedRefund;

export type DetailResponseAssessment = {
  accepted: boolean;
  normalized: NormalizedTransactionDetail | null;
  dto: Record<string, unknown> | null;
  rejectionReason: string | null;
};

function isSuccessfulEnvelopeCode(code: string | null): boolean {
  if (code === null) return true;
  const normalized = code.trim().toLowerCase();
  return (
    normalized === "0000" || normalized === "0" || normalized === "200" || normalized === "success"
  );
}

function isBareEnvelope(dto: Record<string, unknown>): boolean {
  const transactionKeys = new Set([
    "id",
    "guid",
    "uuid",
    "docno",
    "doccode",
    "customerid",
    "customercode",
    "debtorid",
    "debtorcode",
  ]);
  return !Object.keys(dto).some((key) => transactionKeys.has(key.toLowerCase()));
}

/**
 * The single acceptance gate for N3 transaction-detail responses.
 *
 * Rejected responses remain diagnostic evidence only. They never enter
 * comparisons, normalized counts, or detail field maps.
 */
export function assessDetailResponse(args: {
  resource: Exclude<FinResource, "gl_accounts">;
  httpStatus: number | null;
  envelopeCode: string | null;
  body: unknown;
  sourceListId: string;
  transportError?: string;
}): DetailResponseAssessment {
  if (args.transportError) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "transport_error",
    };
  }
  if (typeof args.httpStatus !== "number" || args.httpStatus < 200 || args.httpStatus >= 300) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "http_not_success",
    };
  }
  if (!isSuccessfulEnvelopeCode(args.envelopeCode)) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "n3_error_envelope",
    };
  }
  if (isPlainObject(args.body)) {
    const hasData = Object.prototype.hasOwnProperty.call(args.body, "data");
    const hasPascalData = Object.prototype.hasOwnProperty.call(args.body, "Data");
    if (hasData || hasPascalData) {
      const data = hasData ? args.body.data : args.body.Data;
      const usableArray = Array.isArray(data) && data.length > 0 && isPlainObject(data[0]);
      if (!isPlainObject(data) && !usableArray) {
        return {
          accepted: false,
          normalized: null,
          dto: null,
          rejectionReason: "empty_or_invalid_detail_data",
        };
      }
    }
  }

  const dto = innerDetailOf(args.body);
  if (!dto || isBareEnvelope(dto)) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "not_transaction_detail",
    };
  }

  let normalized: NormalizedTransactionDetail | null = null;
  if (args.resource === "ar_receipts") {
    normalized = normalizeReceiptDetail(args.body);
  } else if (args.resource === "cash_sales") {
    normalized = normalizeCashSaleDetail(args.body);
  } else {
    normalized = normalizeRefundDetail(args.body);
  }

  if (!normalized?.id) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "missing_detail_id",
    };
  }
  if (!normalized.docNo && !normalized.docCode) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "missing_document_identity",
    };
  }
  if (normalized.id.trim().toLowerCase() !== args.sourceListId.trim().toLowerCase()) {
    return {
      accepted: false,
      normalized: null,
      dto: null,
      rejectionReason: "detail_id_mismatch",
    };
  }
  return { accepted: true, normalized, dto, rejectionReason: null };
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
  rejectionReason?: string;
};

export type DetailFanOut = {
  cap: number;
  requested: number;
  performed: number;
  normalized: number;
  skipped: boolean;
  reason: string | null;
  evidence: DetailEvidence[];
};

async function fetchDetailById(
  token: string,
  root: string,
  id: string,
  sourceListDocNo: string | null,
): Promise<{ evidence: DetailEvidence; body: unknown }> {
  const path = `${root}/${encodeURIComponent(id)}`;
  const call = await callOnce(token, path);
  const evidence: DetailEvidence = {
    sourceListId: id,
    sourceListDocNo,
    endpoint: path,
    httpStatus: call.attempt.httpStatus,
    envelopeCode: call.attempt.envelopeCode,
    sanitizedSample: call.attempt.responseSample,
    fieldNamesObserved: [],
    ...(call.attempt.error ? { error: call.attempt.error } : {}),
  };
  return { evidence, body: call.body };
}

async function fanOutDetails(
  token: string,
  resource: Exclude<FinResource, "gl_accounts">,
  matchedRows: unknown[],
): Promise<{
  fanOut: DetailFanOut;
  successfulDetails: Array<{
    normalized: NormalizedTransactionDetail;
    dto: Record<string, unknown>;
  }>;
}> {
  const root = RESOURCE_DETAIL_ROOT[resource];
  const requested = matchedRows.length;
  if (requested === 0) {
    return {
      fanOut: {
        cap: DETAIL_FANOUT_CAP,
        requested: 0,
        performed: 0,
        normalized: 0,
        skipped: false,
        reason: null,
        evidence: [],
      },
      successfulDetails: [],
    };
  }
  if (requested > DETAIL_FANOUT_CAP) {
    return {
      fanOut: {
        cap: DETAIL_FANOUT_CAP,
        requested,
        performed: 0,
        normalized: 0,
        skipped: true,
        reason: "narrow_filters_required",
        evidence: [],
      },
      successfulDetails: [],
    };
  }
  const evidence: DetailEvidence[] = [];
  const successfulDetails: Array<{
    normalized: NormalizedTransactionDetail;
    dto: Record<string, unknown>;
  }> = [];
  for (const row of matchedRows) {
    const id = rowId(row);
    if (!id) continue;
    const docNo = isPlainObject(row)
      ? ((row.DocNo as string | undefined) ?? (row.docNo as string | undefined) ?? null)
      : null;
    const res = await fetchDetailById(token, root, id, docNo);
    const assessment = assessDetailResponse({
      resource,
      httpStatus: res.evidence.httpStatus,
      envelopeCode: res.evidence.envelopeCode,
      body: res.body,
      sourceListId: id,
      transportError: res.evidence.error,
    });
    if (assessment.accepted && assessment.normalized && assessment.dto) {
      res.evidence.fieldNamesObserved = Object.keys(assessment.dto);
      successfulDetails.push({
        normalized: assessment.normalized,
        dto: assessment.dto,
      });
    } else {
      res.evidence.rejectionReason = assessment.rejectionReason ?? "detail_rejected";
    }
    evidence.push(res.evidence);
  }
  return {
    fanOut: {
      cap: DETAIL_FANOUT_CAP,
      requested,
      performed: evidence.length,
      normalized: successfulDetails.length,
      skipped: false,
      reason: null,
      evidence,
    },
    successfulDetails,
  };
}

// ---- Resource fetch (list) -----------------------------------------------

export type ResourceReport = {
  resource: FinResource;
  status: FetchStatus;
  chosenEndpoint: string | null;
  endpointAttempts: EndpointAttempt[];
  contractValidation: ContractValidation | null;
  rows: unknown[]; // sanitized rows kept after date + filter application
  totalReported: number | null;
  fetched: number;
  matched: number;
  pagesFetched: number;
  truncated: boolean;
  elapsedMs: number;
  mafLabel: MafLabel;
  filterDiagnostic: FilterDiagnostic | null;
  detailFanOut: DetailFanOut | null;
  listFieldMap: { observed: string[] };
  detailFieldMap: { observed: string[] };
  note?: string;
};

// Internal-only carry with normalised detail DTOs; NEVER exported.
type InternalResource = ResourceReport & {
  _normalizedDetails: unknown[];
};

async function fetchListResource(
  token: string,
  resource: FinResource,
  from: string,
  to: string,
  filters: NormalizedFilters,
  tenantCustomer: { code: string | null } | null,
): Promise<InternalResource> {
  const startedAll = Date.now();
  const candidates = RESOURCE_CANDIDATES[resource];
  const attempts: EndpointAttempt[] = [];
  let chosen: string | null = null;
  let firstOk: InternalCall | null = null;
  let contract: ContractValidation | null = null;

  for (const base of candidates) {
    const first = await callOnce(token, `${base}?$top=${PAGE_TOP}&$skip=0`);
    attempts.push(first.attempt);
    if (first.attempt.httpStatus === 401) {
      return {
        resource,
        status: "unauthorized",
        chosenEndpoint: base,
        endpointAttempts: attempts,
        contractValidation: null,
        rows: [],
        totalReported: null,
        fetched: 0,
        matched: 0,
        pagesFetched: 1,
        truncated: false,
        elapsedMs: Date.now() - startedAll,
        mafLabel: "Not Available",
        filterDiagnostic: null,
        detailFanOut: null,
        listFieldMap: { observed: [] },
        detailFieldMap: { observed: [] },
        note: "N3 returned 401 Unauthorized",
        _normalizedDetails: [],
      };
    }
    const s = first.attempt.httpStatus;
    if (s === null || s < 200 || s >= 300 || first.rawItems === null) {
      continue; // non-2xx or unrecognised envelope — try next candidate
    }
    // Semantic validation inside the loop.
    const rows = first.rawItems ?? [];
    const cv = validateContract(resource, rows, first.attempt.envelopeMessage);
    contract = cv;
    if (!cv.passed) {
      // Mismatch: continue to next candidate. Keep the attempt evidence.
      continue;
    }
    chosen = base;
    firstOk = first;
    break;
  }

  if (!chosen || !firstOk) {
    const anyReached = attempts.some((a) => typeof a.httpStatus === "number");
    return {
      resource,
      status: anyReached ? "invalid_contract" : "unavailable",
      chosenEndpoint: null,
      endpointAttempts: attempts,
      contractValidation: contract,
      rows: [],
      totalReported: null,
      fetched: 0,
      matched: 0,
      pagesFetched: attempts.length,
      truncated: false,
      elapsedMs: Date.now() - startedAll,
      mafLabel: anyReached ? "Mismatch" : "Not Available",
      filterDiagnostic: null,
      detailFanOut: null,
      listFieldMap: { observed: [] },
      detailFieldMap: { observed: [] },
      note: contract
        ? `Semantic contract failed: ${contract.reason}${
            contract.suspectedResource ? ` (suspected: ${contract.suspectedResource})` : ""
          }`
        : anyReached
          ? "No candidate endpoint returned a recognised N3 list envelope"
          : "No candidate endpoint reachable",
      _normalizedDetails: [],
    };
  }

  const firstRows = firstOk.rawItems ?? [];

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
    const s = next.attempt.httpStatus;
    if (next.attempt.error || s === null || s < 200 || s >= 300) {
      attempts.push(next.attempt);
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

  const { rows: filtered, diagnostic } = applyFilters(resource, inRange, filters, tenantCustomer);

  // Detail fan-out (transaction resources only).
  let detailFanOut: DetailFanOut | null = null;
  const normalizedDetails: unknown[] = [];
  // Observed = actual N3 DTO field names from successful 2xx detail bodies,
  // NOT the normalized property names of our DTOs.
  const observedDetailKeys = new Set<string>();
  if (resource !== "gl_accounts") {
    const res = await fanOutDetails(token, resource, filtered);
    detailFanOut = res.fanOut;
    for (const detail of res.successfulDetails) {
      for (const k of Object.keys(detail.dto)) observedDetailKeys.add(k);
      normalizedDetails.push(detail.normalized);
    }
  }

  return {
    resource,
    status: "success",
    chosenEndpoint: chosen,
    endpointAttempts: attempts,
    contractValidation: contract,
    rows: filtered.map((r) => sanitize(r)),
    totalReported: reportedTotal,
    fetched: deduped.length,
    matched: filtered.length,
    pagesFetched: pages,
    truncated,
    elapsedMs: Date.now() - startedAll,
    mafLabel: "Live N3 Confirmed",
    filterDiagnostic: diagnostic,
    detailFanOut,
    listFieldMap: { observed: unionKeys(filtered, 8) },
    detailFieldMap: { observed: Array.from(observedDetailKeys).slice(0, 24) },
    _normalizedDetails: normalizedDetails,
  };
}

// ---- Run orchestrator ----------------------------------------------------

export type FinancialVerificationRun = {
  schemaVersion: string;
  runId: string;
  runAt: string;
  dateFrom: string;
  dateTo: string;
  tenant: { code: string | null; name: string | null }; // tenant.id EXCLUDED
  filters: NormalizedFilters;
  resources: ResourceReport[]; // public shape only
  elapsedMs: number;
};

function makeRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `${ts}-${rand}`;
}

// Strip the internal-only carry off a resource before it can be handed to
// the browser or serialized into the bundle.
function publicResource(r: InternalResource): ResourceReport {
  const { _normalizedDetails: _drop, ...safe } = r;
  void _drop;
  return safe;
}

export type FinancialBundle = {
  schemaVersion: string;
  runId: string;
  runAt: string;
  tenant: { code: string | null; name: string | null };
  dateRange: { from: string; to: string };
  filters: NormalizedFilters;
  resources: ResourceReport[];
  comparisons: {
    orToCashMemo: KnockoffMatch[];
    refundToOr: RefundKnockoffMatch[];
  };
  glEligibility: Array<{ row: unknown } & GlEligibilityDetail>;
  fieldMaps: {
    arReceiptList: { observed: string[] };
    arReceiptDetail: { observed: string[] };
    cashSalesList: { observed: string[] };
    cashSalesDetail: { observed: string[] };
    customerRefundList: { observed: string[] };
    customerRefundDetail: { observed: string[] };
    glAccountList: { observed: string[] };
  };
  conclusions: Array<{ resource: FinResource; label: MafLabel; note: string | null }>;
  refundLinkState: RefundLinkState;
  elapsedMs: number;
};

export type RefundLinkState = {
  state: "linked" | "unapplied" | "not_available";
  label: string;
  note: string;
  acceptedRefundDetails: number;
  refundsWithKnockoffs: number;
  comparisonRows: number;
};

/**
 * 5d0.3B: three-way refund evidence state. Never inferred from comparison
 * row count alone.
 */
export function deriveRefundLinkState(input: {
  resourceStatus: string | null;
  contractPassed: boolean | null;
  refundDetails: NormalizedRefund[];
  comparisonRows: number;
}): RefundLinkState {
  const accepted = input.refundDetails.length;
  const withKnockoffs = input.refundDetails.filter(
    (r) => Array.isArray(r.knockoffs) && r.knockoffs.length > 0,
  ).length;
  const base = {
    acceptedRefundDetails: accepted,
    refundsWithKnockoffs: withKnockoffs,
    comparisonRows: input.comparisonRows,
  };
  if (input.resourceStatus !== "success" || input.contractPassed !== true || accepted === 0) {
    return {
      state: "not_available",
      label: "Not Available",
      note: "No accepted normalized Customer Refund detail is available for this result.",
      ...base,
    };
  }
  if (withKnockoffs > 0 && input.comparisonRows > 0) {
    return {
      state: "linked",
      label: "Live N3 Confirmed",
      note: "Refund knockoff rows were compared against AR Receipts by immutable N3 ID.",
      ...base,
    };
  }
  if (withKnockoffs === 0) {
    return {
      state: "unapplied",
      label: "Unapplied — No OR Linked",
      note: "The Customer Refund was retrieved successfully from N3 but currently has no AR Receipt (OR) knockoff.",
      ...base,
    };
  }
  return {
    state: "not_available",
    label: "Not Available",
    note: "Refund knockoffs exist but no AR Receipt could be resolved for comparison.",
    ...base,
  };
}


export async function runFinancialVerification(input: {
  token: string;
  dateFrom: string;
  dateTo: string;
  tenant: { id?: string | null; code: string | null; name: string | null };
  filters?: NormalizedFilters;
  tenantCustomer?: { code: string | null } | null;
}): Promise<{
  run: FinancialVerificationRun;
  bundle: FinancialBundle;
  _internal: InternalResource[];
}> {
  const started = Date.now();
  const filters = normalizeFilters(input.filters);
  const tc = input.tenantCustomer ?? null;
  const internals = await Promise.all([
    fetchListResource(input.token, "ar_receipts", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "cash_sales", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "customer_refunds", input.dateFrom, input.dateTo, filters, tc),
    fetchListResource(input.token, "gl_accounts", input.dateFrom, input.dateTo, filters, tc),
  ]);
  const resources = internals.map(publicResource);

  const ar = internals.find((r) => r.resource === "ar_receipts");
  const cs = internals.find((r) => r.resource === "cash_sales");
  const rf = internals.find((r) => r.resource === "customer_refunds");
  const gl = internals.find((r) => r.resource === "gl_accounts");

  // Comparisons use NORMALISED DETAIL DTOs — never list rows.
  const arDetails = (ar?._normalizedDetails ?? []) as NormalizedReceipt[];
  const csDetails = (cs?._normalizedDetails ?? []) as NormalizedCashSale[];
  const rfDetails = (rf?._normalizedDetails ?? []) as NormalizedRefund[];

  const orToCashMemo =
    ar && cs && ar.status === "success" && cs.status === "success"
      ? compareReceiptKnockoffs(arDetails, csDetails)
      : [];
  const refundToOr =
    rf && ar && rf.status === "success" && ar.status === "success"
      ? compareRefundKnockoffs(rfDetails, arDetails)
      : [];

  const glEligibility =
    gl && gl.status === "success" ? gl.rows.map((row) => ({ row, ...evaluateGlAccount(row) })) : [];

  const conclusions = resources.map((r) => ({
    resource: r.resource,
    label: r.mafLabel,
    note: r.note ?? null,
  }));

  const tenantPublic = { code: input.tenant.code, name: input.tenant.name };

  const run: FinancialVerificationRun = {
    schemaVersion: FINANCIAL_BUNDLE_SCHEMA_VERSION,
    runId: makeRunId(),
    runAt: new Date().toISOString(),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    tenant: tenantPublic,
    filters,
    resources,
    elapsedMs: Date.now() - started,
  };

  const bundle: FinancialBundle = {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    runAt: run.runAt,
    tenant: tenantPublic,
    dateRange: { from: input.dateFrom, to: input.dateTo },
    filters,
    resources,
    comparisons: { orToCashMemo, refundToOr },
    glEligibility,
    fieldMaps: {
      arReceiptList: ar?.listFieldMap ?? { observed: [] },
      arReceiptDetail: ar?.detailFieldMap ?? { observed: [] },
      cashSalesList: cs?.listFieldMap ?? { observed: [] },
      cashSalesDetail: cs?.detailFieldMap ?? { observed: [] },
      customerRefundList: rf?.listFieldMap ?? { observed: [] },
      customerRefundDetail: rf?.detailFieldMap ?? { observed: [] },
      glAccountList: gl?.listFieldMap ?? { observed: [] },
    },
    conclusions,
    refundLinkState: deriveRefundLinkState({
      resourceStatus: rf?.status ?? null,
      contractPassed: rf?.contractValidation?.passed ?? null,
      refundDetails: rfDetails,
      comparisonRows: refundToOr.length,
    }),
    elapsedMs: run.elapsedMs,

  };

  return { run, bundle, _internal: internals };
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

  const active = toBool(
    pick(row, ["Active", "active", "IsActive", "isActive", "Enabled", "enabled"]),
  );
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

export function classifyGlAccount(row: unknown): GlEligibility {
  return evaluateGlAccount(row).eligibility;
}

// ---- OR knockoffs (parsing + comparison) ---------------------------------

export type ParsedKnockoff = {
  docType: string | null;
  docTypeNormalized: string | null;
  docId: string | null;
  docNo: string | null;
  docCode: string | null;
  appliedAmount: number | null;
};

function extractKnockoffs(row: Record<string, unknown>): ParsedKnockoff[] {
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
    });
  }
  return parsed;
}

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
  docNoAgrees: boolean | null;
  customerMatch: boolean | null;
  correlation: "immutable_id" | "document_number_only" | "mismatch" | "not_available";
  evidenceLabel:
    "Immutable ID confirmed" | "Document-number only — not proven" | "Mismatch" | "Not available";
};

// Union input: legacy list-row shape OR NormalizedReceipt / NormalizedCashSale.
// The orchestrator hands us NormalizedReceipt[] and NormalizedCashSale[] but
// tests may hand us minimal list-row objects.
type ReceiptLike = Partial<NormalizedReceipt> & Record<string, unknown>;
type CashSaleLike = Partial<NormalizedCashSale> & Record<string, unknown>;

function receiptId(rec: ReceiptLike): string | null {
  return typeof rec.id === "string" && rec.id ? rec.id : rowId(rec);
}
function receiptDocNo(rec: ReceiptLike): string | null {
  return typeof rec.docNo === "string" && rec.docNo
    ? rec.docNo
    : normStr(pick(rec as Record<string, unknown>, ["DocNo", "docNo"]));
}
function receiptCustomer(rec: ReceiptLike): string | null {
  return typeof rec.customerId === "string" && rec.customerId
    ? rec.customerId
    : normStr(
        pick(rec as Record<string, unknown>, ["CustomerId", "customerId", "DebtorId", "debtorId"]),
      );
}
function receiptKnockoffs(rec: ReceiptLike): ParsedKnockoff[] {
  if (
    Array.isArray(rec.knockoffs) &&
    rec.knockoffs.length &&
    isPlainObject(rec.knockoffs[0]) &&
    "docTypeNormalized" in (rec.knockoffs[0] as object)
  ) {
    return rec.knockoffs as ParsedKnockoff[];
  }
  return extractKnockoffs(rec as Record<string, unknown>);
}
function csId(cs: CashSaleLike): string | null {
  return typeof cs.id === "string" && cs.id ? cs.id : rowId(cs);
}
function csDocNo(cs: CashSaleLike): string | null {
  return typeof cs.docNo === "string" && cs.docNo
    ? cs.docNo
    : normStr(pick(cs as Record<string, unknown>, ["DocNo", "docNo"]));
}
function csDocCode(cs: CashSaleLike): string | null {
  return typeof cs.docCode === "string" && cs.docCode
    ? cs.docCode
    : normStr(pick(cs as Record<string, unknown>, ["DocCode", "docCode"]));
}
function csCustomer(cs: CashSaleLike): string | null {
  return typeof cs.customerId === "string" && cs.customerId
    ? cs.customerId
    : normStr(
        pick(cs as Record<string, unknown>, ["CustomerId", "customerId", "DebtorId", "debtorId"]),
      );
}

export function compareReceiptKnockoffs(
  arReceipts: unknown[],
  cashSales: unknown[],
): KnockoffMatch[] {
  const csById = new Map<string, CashSaleLike>();
  const csByDocNo = new Map<string, CashSaleLike>();
  for (const raw of cashSales) {
    if (!isPlainObject(raw)) continue;
    const c = raw as CashSaleLike;
    const id = csId(c);
    const dn = csDocNo(c);
    if (id) csById.set(id.toUpperCase(), c);
    if (dn) csByDocNo.set(dn.toUpperCase(), c);
  }
  const out: KnockoffMatch[] = [];
  for (const rec of arReceipts) {
    if (!isPlainObject(rec)) continue;
    const r = rec as ReceiptLike;
    const rid = receiptId(r);
    const rdn = receiptDocNo(r);
    const rcust = receiptCustomer(r);
    for (const k of receiptKnockoffs(r)) {
      if (k.docTypeNormalized !== "INV") continue;
      const byId = k.docId ? csById.get(k.docId.toUpperCase()) : undefined;
      const byNo = !byId && k.docNo ? csByDocNo.get(k.docNo.toUpperCase()) : undefined;
      const cs = byId ?? byNo ?? null;
      const csid = cs ? csId(cs) : null;
      const csdn = cs ? csDocNo(cs) : null;
      const csdc = cs ? csDocCode(cs) : null;
      const csc = cs ? csCustomer(cs) : null;
      const sameUuid = k.docId && csid ? k.docId.toUpperCase() === csid.toUpperCase() : null;
      const docNoAgrees =
        k.docNo && csdn ? k.docNo.trim().toUpperCase() === csdn.trim().toUpperCase() : null;
      const customerMatch = rcust && csc ? rcust.toUpperCase() === csc.toUpperCase() : null;

      let correlation: KnockoffMatch["correlation"];
      let evidenceLabel: KnockoffMatch["evidenceLabel"];
      // ID resolves but docNo disagrees → Mismatch (5d0.3 requirement).
      if (byId && k.docNo && csdn && docNoAgrees === false) {
        correlation = "mismatch";
        evidenceLabel = "Mismatch";
      } else if (byId) {
        correlation = "immutable_id";
        evidenceLabel = "Immutable ID confirmed";
      } else if (k.docId && csid && k.docId.toUpperCase() !== csid.toUpperCase()) {
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
        receiptId: rid,
        receiptDocNo: rdn,
        docType: k.docType,
        docId: k.docId,
        docNo: k.docNo,
        docCode: k.docCode,
        appliedAmount: k.appliedAmount,
        candidateCashSalesId: csid,
        candidateCashSalesDocNo: csdn,
        candidateCashSalesDocCode: csdc,
        sameUuid,
        docNoAgrees,
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
  const source = pick(row, [
    "Source",
    "source",
    "OriginModule",
    "originModule",
    "FromModule",
    "fromModule",
  ]);
  const s = String(source ?? "").toLowerCase();
  if (s.includes("gl") || s.includes("journal")) return "gl_originated_or";
  const customer = pick(row, [
    "CustomerId",
    "customerId",
    "DebtorId",
    "debtorId",
    "CustomerCode",
    "customerCode",
  ]);
  if (customer) return "ar_receipt";
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
  docNoAgrees: boolean | null;
  customerMatch: boolean | null;
  correlation: "immutable_id" | "document_number_only" | "mismatch" | "not_available";
  evidenceLabel:
    "Immutable ID confirmed" | "Document-number only — not proven" | "Mismatch" | "Not available";
};

export function compareRefundKnockoffs(
  customerRefunds: unknown[],
  arReceipts: unknown[],
): RefundKnockoffMatch[] {
  const orById = new Map<string, ReceiptLike>();
  const orByDocNo = new Map<string, ReceiptLike>();
  for (const raw of arReceipts) {
    if (!isPlainObject(raw)) continue;
    const r = raw as ReceiptLike;
    const id = receiptId(r);
    const dn = receiptDocNo(r);
    if (id) orById.set(id.toUpperCase(), r);
    if (dn) orByDocNo.set(dn.toUpperCase(), r);
  }
  const out: RefundKnockoffMatch[] = [];
  for (const rf of customerRefunds) {
    if (!isPlainObject(rf)) continue;
    const rfl = rf as Partial<NormalizedRefund> & Record<string, unknown>;
    const rfid = typeof rfl.id === "string" ? rfl.id : rowId(rfl);
    const rfdn = typeof rfl.docNo === "string" ? rfl.docNo : normStr(pick(rfl, ["DocNo", "docNo"]));
    const rfcust =
      typeof rfl.customerId === "string"
        ? rfl.customerId
        : normStr(pick(rfl, ["CustomerId", "customerId", "DebtorId", "debtorId"]));
    const kos =
      Array.isArray(rfl.knockoffs) &&
      rfl.knockoffs.length &&
      isPlainObject(rfl.knockoffs[0]) &&
      "docTypeNormalized" in (rfl.knockoffs[0] as object)
        ? (rfl.knockoffs as ParsedKnockoff[])
        : extractKnockoffs(rfl);
    for (const k of kos) {
      if (k.docTypeNormalized && !["OR", "RECEIPT", "AR"].includes(k.docTypeNormalized)) continue;
      const byId = k.docId ? orById.get(k.docId.toUpperCase()) : undefined;
      const byNo = !byId && k.docNo ? orByDocNo.get(k.docNo.toUpperCase()) : undefined;
      const or = byId ?? byNo ?? null;
      const orid = or ? receiptId(or) : null;
      const ordn = or ? receiptDocNo(or) : null;
      const orcust = or ? receiptCustomer(or) : null;
      const sameUuid = k.docId && orid ? k.docId.toUpperCase() === orid.toUpperCase() : null;
      const docNoAgrees =
        k.docNo && ordn ? k.docNo.trim().toUpperCase() === ordn.trim().toUpperCase() : null;
      const customerMatch = rfcust && orcust ? rfcust.toUpperCase() === orcust.toUpperCase() : null;

      let correlation: RefundKnockoffMatch["correlation"];
      let evidenceLabel: RefundKnockoffMatch["evidenceLabel"];
      if (byId && k.docNo && ordn && docNoAgrees === false) {
        correlation = "mismatch";
        evidenceLabel = "Mismatch";
      } else if (byId) {
        correlation = "immutable_id";
        evidenceLabel = "Immutable ID confirmed";
      } else if (k.docId && orid && k.docId.toUpperCase() !== orid.toUpperCase()) {
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
        refundId: rfid,
        refundDocNo: rfdn,
        docType: k.docType,
        docId: k.docId,
        docNo: k.docNo,
        docCode: k.docCode,
        appliedAmount: k.appliedAmount,
        candidateReceiptId: orid,
        candidateReceiptDocNo: ordn,
        sameUuid,
        docNoAgrees,
        customerMatch,
        correlation,
        evidenceLabel,
      });
    }
  }
  return out;
}

// ---- Field maps (legacy helper kept for callers) -------------------------

export function buildFieldMap(rows: unknown[]): Record<string, string[]> {
  return { observed: unionKeys(rows, 8) };
}
