import { parseN3LosslessJson } from "./n3-lossless-json.server";

export type JournalDocument = {
  resource: "ar_receipts" | "cash_sales" | "customer_refunds";
  id: string;
  docCode: string | null;
};
export type JournalCaptureEvidence = JournalDocument & {
  endpoint: string;
  method: "GET";
  timestamp: string;
  httpStatus: number | null;
  envelopeCode: string | null;
  status: "captured" | "unavailable" | "unauthorized";
  durationMs: number;
  responseSample: unknown;
  sampleTruncated: boolean;
  error?: string;
};
export type JournalCaptureReport = {
  status: "not_requested" | "captured" | "partial" | "unavailable" | "unauthorized";
  cap: number;
  requested: number;
  performed: number;
  captured: number;
  sourceIncomplete: boolean;
  truncated: boolean;
  note: string;
  evidence: JournalCaptureEvidence[];
};
const PATHS = {
  ar_receipts: "/api/ARReceipts/GLPosting",
  cash_sales: "/api/CashSales/GLPosting",
  customer_refunds: "/api/CustomerRefunds/GLPosting",
} as const;
const CAP = 12;
const BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const OMIT = new Set([
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
  "tenantid",
  "tenant_id",
]);

// Remove internal/credential properties before the existing recursive personal
// data sanitizer. No upstream diagnostic text may disclose this session token.
function publicJournalText(value: string, token: string, field: string): string {
  const clean = value.replaceAll(token, "[redacted]");
  const key = field.toLowerCase();
  // Unknown journal shapes are diagnostic evidence, not accepted contracts.
  // Retain only typed financial identifiers/codes/dates/numeric amounts;
  // descriptions, names, notes and other free text can contain personal data.
  if ((key === "id" || key.endsWith("id")) && (UUID.test(clean) || /^\d{1,40}$/.test(clean)))
    return clean;
  if (
    /^(code|doccode|docno|reference(?:no)?|specialcode|doctype|currencycode|typecode)$/.test(key) &&
    /^[a-z0-9][a-z0-9._/-]{0,99}$/i.test(clean)
  )
    return clean;
  if (/(debit|credit|amount|rate)(local)?$/.test(key) && /^-?\d+(?:\.\d+)?$/.test(clean))
    return clean;
  if (/(date|timestamp)$/.test(key) && /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?$/.test(clean))
    return clean;
  return "[redacted_text]";
}
function publicSample(
  value: unknown,
  token: string,
  depth = 0,
  tenant = false,
  field = "",
): unknown {
  if (depth > 8) return "[depth_limited]";
  if (typeof value === "string") return publicJournalText(value, token, field);
  if (Array.isArray(value))
    return value.slice(0, 201).map((v) => publicSample(v, token, depth + 1, tenant, field));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !OMIT.has(key.toLowerCase()) &&
            !(tenant && key.toLowerCase() === "id") &&
            !key.includes(token) &&
            /^[a-z_][a-z0-9_]{0,79}$/i.test(key),
        )
        .map(([key, v]) => [
          key,
          publicSample(v, token, depth + 1, tenant || key.toLowerCase() === "tenant", key),
        ]),
    );
  return value;
}
function exceedsSample(value: unknown, depth = 0): boolean {
  if (depth > 8 || (typeof value === "string" && value.length > 4096)) return true;
  if (Array.isArray(value))
    return value.length > 200 || value.some((v) => exceedsSample(v, depth + 1));
  return object(value) && Object.values(value).some((v) => exceedsSample(v, depth + 1));
}
async function readLimited(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error("journal_body_too_large");
  }
  if (!response.body) throw new Error("journal_body_missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error("journal_body_too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function captureFinancialJournals(
  input: {
    token: string;
    enabled: boolean;
    documents: JournalDocument[];
    sourceIncomplete?: boolean;
  },
  sanitize: (value: unknown) => unknown,
): Promise<JournalCaptureReport> {
  const report: JournalCaptureReport = {
    status: "not_requested",
    cap: CAP,
    requested: 0,
    performed: 0,
    captured: 0,
    sourceIncomplete: input.sourceIncomplete === true,
    truncated: false,
    note: "Journal capture not requested.",
    evidence: [],
  };
  if (!input.enabled) return report;
  report.status = "unavailable";
  report.note = "Captured responses only; posting correctness is not verified.";
  if (typeof input.token !== "string" || input.token.length < 8 || /[\r\n]/.test(input.token))
    return report;
  const unique = new Map<string, JournalDocument>();
  let invalid = false;
  for (const d of input.documents) {
    if (
      !d ||
      !Object.prototype.hasOwnProperty.call(PATHS, d.resource) ||
      typeof d.id !== "string" ||
      !UUID.test(d.id) ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(d.id)
    ) {
      invalid = true;
      continue;
    }
    const id = d.id.toLowerCase();
    unique.set(d.resource + ":" + id, {
      resource: d.resource,
      id,
      docCode:
        typeof d.docCode === "string" ? publicJournalText(d.docCode, input.token, "docCode") : null,
    });
  }
  report.requested = unique.size;
  report.truncated = unique.size > CAP || invalid;
  const documents = [...unique.values()].slice(0, CAP);
  const deadline = Date.now() + 40_000;
  let next = 0,
    unauthorized = false;
  const results: JournalCaptureEvidence[] = [];
  async function worker() {
    while (!unauthorized && next < documents.length && Date.now() < deadline) {
      const index = next++,
        d = documents[index];
      const started = Date.now(),
        endpoint = PATHS[d.resource];
      const evidence: JournalCaptureEvidence = {
        ...d,
        endpoint,
        method: "GET",
        timestamp: new Date(started).toISOString(),
        httpStatus: null,
        envelopeCode: null,
        status: "unavailable",
        durationMs: 0,
        responseSample: null,
        sampleTruncated: false,
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(10_000, deadline - started));
      try {
        const response = await fetch(
          "https://openapi.account.qne.cloud" + endpoint + "?key=" + d.id,
          {
            method: "GET",
            headers: { authorization: "Bearer " + input.token, accept: "application/json" },
            signal: controller.signal,
            redirect: "error",
          },
        );
        evidence.httpStatus = response.status;
        if (response.status === 401) {
          unauthorized = true;
          evidence.status = "unauthorized";
          void response.body?.cancel().catch(() => {});
        } else if (response.status < 200 || response.status >= 300) {
          evidence.error = "journal_http_error";
          void response.body?.cancel().catch(() => {});
        } else {
          const body = parseN3LosslessJson(await readLimited(response));
          if (!object(body)) throw new Error("journal_contract_unavailable");
          const codes = [body.code, body.Code].filter((v) => v != null);
          // Do not export arbitrary error text through metadata outside the
          // sample sanitizer. Valid envelope codes are short numeric codes.
          evidence.envelopeCode =
            typeof codes[0] === "string" && /^\d{4}$/.test(codes[0]) ? codes[0] : null;
          const data = body.data ?? body.Data;
          if (
            !codes.length ||
            codes.some((v) => v !== "0000") ||
            !(Array.isArray(data) ? data.length > 0 : object(data) && Object.keys(data).length > 0)
          )
            throw new Error("journal_contract_unavailable");
          evidence.sampleTruncated = exceedsSample(body);
          evidence.responseSample = sanitize(publicSample(body, input.token));
          evidence.status = "captured";
        }
      } catch {
        evidence.error = "journal_read_unavailable";
      } finally {
        clearTimeout(timer);
        evidence.durationMs = Date.now() - started;
        results[index] = evidence;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, documents.length) }, () => worker()));
  report.evidence = results;
  report.performed = results.length;
  report.captured = results.filter((r) => r.status === "captured").length;
  report.truncated ||= results.length < documents.length || results.some((r) => r.sampleTruncated);
  report.status = unauthorized
    ? "unauthorized"
    : report.captured === 0
      ? "unavailable"
      : report.truncated || report.sourceIncomplete || report.captured !== report.requested
        ? "partial"
        : "captured";
  return report;
}
