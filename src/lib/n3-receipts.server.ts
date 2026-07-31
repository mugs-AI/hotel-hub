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

async function n3Request(
  token: string,
  method: "GET" | "POST",
  path: string,
  jsonBody?: unknown,
): Promise<N3Outcome> {
  const controller = new AbortController();
  const timeoutMs = method === "POST" ? N3_WRITE_TIMEOUT_MS : N3_READ_TIMEOUT_MS;
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
    const text = await res.text();
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
  listByReference(token: string, referenceNo: string): Promise<N3Outcome>;
  getById(token: string, id: string): Promise<N3Outcome>;
  create(token: string, payload: unknown): Promise<N3Outcome>;
};

export const n3Receipts: N3ReceiptsClient = {
  getNew(token) {
    return n3Request(token, "GET", "/api/ARReceipts/New");
  },
  listByReference(token, referenceNo) {
    // Server-owned, validated, encoded query. Never browser input.
    if (!isSafeReferenceNo(referenceNo)) {
      throw new Error("listByReference: unsafe reference");
    }
    const filter = encodeURIComponent(`referenceNo eq '${referenceNo}'`);
    return n3Request(token, "GET", `/api/ARReceipts/List?$top=20&$skip=0&$filter=${filter}`);
  },
  getById(token, id) {
    if (!isRealN3Id(id)) throw new Error("getById: unsafe id");
    return n3Request(token, "GET", `/api/ARReceipts/${encodeURIComponent(id)}`);
  },
  create(token, payload) {
    return n3Request(token, "POST", "/api/ARReceipts/Create", payload);
  },
};
