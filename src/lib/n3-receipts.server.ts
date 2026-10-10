// Server-only N3 AR Receipts boundary.
//
// SAFETY CONTRACT
// - Fixed operation set only. No browser-supplied path, method, query or body.
// - The session N3 token never leaves this module (never logged, never returned).
// - Raw N3 bodies are returned ONLY to server-side business logic.
// - Every call is bounded by an AbortController timeout and a response-size cap.
// - `callN3Path()` in n3-gateway.server.ts remains GET-only and untouched.

const MAIN_BASE = process.env.OPEN_API_BASE_URL ?? "https://openapi.account.qne.cloud";

const N3_WRITE_TIMEOUT_MS = 30_000;
const N3_READ_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export type N3Outcome =
  | { kind: "response"; status: number; body: unknown; durationMs: number }
  /** Timeout / connection loss / oversized or unparsable transport failure. */
  | { kind: "transport_error"; reason: "timeout" | "network" | "too_large"; durationMs: number };

// Transport provenance stays in server memory, outside the upstream body/DTO.
// Only this fixed GET operation can register a response; JSON cannot forge it.
const receiptJournalReads = new WeakMap<object, { receiptId: string; token: string }>();
export function receiptJournalBoundTo(
  outcome: N3Outcome,
  receiptId: string,
  token: string,
): boolean {
  const read = receiptJournalReads.get(outcome);
  return read?.receiptId === receiptId.toLowerCase() && read.token === token;
}

export type N3ExecutionLimit = { deadlineAt: number; signal: AbortSignal };

async function n3Request(
  token: string,
  method: "GET" | "POST",
  path: string,
  jsonBody?: unknown,
  limit?: N3ExecutionLimit,
): Promise<N3Outcome> {
  const controller = new AbortController();
  const defaultMs = method === "POST" ? N3_WRITE_TIMEOUT_MS : N3_READ_TIMEOUT_MS;
  if (limit && (limit.signal.aborted || limit.deadlineAt <= Date.now()))
    return { kind: "transport_error", reason: "timeout", durationMs: 0 };
  const timeoutMs = limit ? Math.min(defaultMs, limit.deadlineAt - Date.now()) : defaultMs;
  const onAbort = () => controller.abort();
  limit?.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(MAIN_BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(jsonBody === undefined ? {} : { "content-type": "application/json" }),
      },
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      signal: controller.signal,
    });
    let text: string;
    if (limit && res.body) {
      const reader = res.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            controller.abort();
            await reader.cancel();
            return {
              kind: "transport_error",
              reason: "too_large",
              durationMs: Date.now() - started,
            };
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      text = new TextDecoder().decode(bytes);
    } else text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return { kind: "transport_error", reason: "too_large", durationMs: Date.now() - started };
    }
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // Malformed JSON is NOT a transport error: the caller must treat a
        // 2xx with an unparsable body as "uncertain", never as success.
        body = null;
      }
    }
    return { kind: "response", status: res.status, body, durationMs: Date.now() - started };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      kind: "transport_error",
      reason: aborted ? "timeout" : "network",
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    limit?.signal.removeEventListener("abort", onAbort);
  }
}

/** Server-generated references are `HH-` + 24 lowercase hex chars (27 total). */
export const N3_REFERENCE_PATTERN = /^HH-[0-9a-f]{24}$/;

export function isSafeReferenceNo(v: unknown): v is string {
  return typeof v === "string" && v.length <= 30 && N3_REFERENCE_PATTERN.test(v);
}

/** N3 immutable IDs are GUIDs; the zero GUID means "not yet saved". */
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export function isRealN3Id(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!t || t === ZERO_GUID) return false;
  // Live evidence shows shortened GUID-like keys too; accept either form but
  // never an all-zero / empty identity.
  if (GUID_RE.test(t)) return true;
  return /^[0-9a-fA-F-]{16,64}$/.test(t) && /[1-9a-fA-F]/.test(t.replace(/-/g, ""));
}

export type N3ReceiptsClient = {
  getNew(token: string): Promise<N3Outcome>;
  listPaymentAccounts(token: string, skip: number): Promise<N3Outcome>;
  getAccountById(token: string, id: string): Promise<N3Outcome>;
  listByReference(token: string, referenceNo: string): Promise<N3Outcome>;
  /** GET-only month discovery (sales-v1 ARReceipts/List docDate filter). */
  listByDocDate?(token: string, q: DocDateListQuery): Promise<N3Outcome>;
  getById(token: string, id: string, limit?: N3ExecutionLimit): Promise<N3Outcome>;
  getGLPosting(token: string, id: string, limit?: N3ExecutionLimit): Promise<N3Outcome>;
  create(token: string, payload: unknown): Promise<N3Outcome>;
};

export type DocDateListQuery = {
  startDate: string;
  endExclusive: string;
  skip: number;
  top: number;
};

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Server-owned, validated, encoded month query. Never browser input. */
export function docDateListPath(q: DocDateListQuery): string {
  if (!ISO_DAY.test(q.startDate) || !ISO_DAY.test(q.endExclusive) || q.startDate >= q.endExclusive)
    throw new Error("listByDocDate: unsafe range");
  if (!Number.isSafeInteger(q.top) || q.top < 1 || q.top > 100)
    throw new Error("listByDocDate: unsafe top");
  if (!Number.isSafeInteger(q.skip) || q.skip < 0 || q.skip > 100_000 || q.skip % q.top !== 0)
    throw new Error("listByDocDate: unsafe skip");
  const filter = encodeURIComponent(`docDate ge ${q.startDate} and docDate lt ${q.endExclusive}`);
  const orderby = encodeURIComponent("docDate desc,docCode desc");
  return `/api/ARReceipts/List?$filter=${filter}&$orderby=${orderby}&$skip=${q.skip}&$top=${q.top}`;
}

export const n3Receipts: N3ReceiptsClient = {
  listByDocDate(token, q) {
    return n3Request(token, "GET", docDateListPath(q));
  },
  getNew(token) {
    return n3Request(token, "GET", "/api/ARReceipts/New");
  },
  listPaymentAccounts(token, skip) {
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 900)
      throw new Error("unsafe account page");
    return n3Request(token, "GET", `/api/AccountCodes/Leaf/Query?$top=100&$skip=${skip}`);
  },
  getAccountById(token, id) {
    if (!isRealN3Id(id)) throw new Error("getAccountById: unsafe id");
    return n3Request(token, "GET", `/api/AccountCodes/${encodeURIComponent(id)}`);
  },
  listByReference(token, referenceNo) {
    // Server-owned, validated, encoded query. Never browser input.
    if (!isSafeReferenceNo(referenceNo)) {
      throw new Error("listByReference: unsafe reference");
    }
    const filter = encodeURIComponent(`referenceNo eq '${referenceNo}'`);
    return n3Request(token, "GET", `/api/ARReceipts/List?$top=20&$skip=0&$filter=${filter}`);
  },
  getById(token, id, limit) {
    if (!isRealN3Id(id)) throw new Error("getById: unsafe id");
    return n3Request(token, "GET", `/api/ARReceipts/${encodeURIComponent(id)}`, undefined, limit);
  },
  async getGLPosting(token, id, limit) {
    if (!isRealN3Id(id)) throw new Error("getGLPosting: unsafe id");
    const outcome = await n3Request(
      token,
      "GET",
      `/api/ARReceipts/GLPosting?key=${encodeURIComponent(id)}`,
      undefined,
      limit,
    );
    receiptJournalReads.set(outcome, { receiptId: id.toLowerCase(), token });
    return outcome;
  },
  create(token, payload) {
    return n3Request(token, "POST", "/api/ARReceipts/Create", payload);
  },
};

/** Fixed server-only dormant Update operation. Caller must hold a durable dispatch. */
export function postReceiptUpdate(
  token: string,
  body: unknown,
  limit: N3ExecutionLimit,
): Promise<N3Outcome> {
  return n3Request(
    token,
    "POST",
    "/api/ARReceipts/Update?confirmedForBankRecon=false&confirmedForKnockOff=false",
    body,
    limit,
  );
}
