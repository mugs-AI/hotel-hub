// Server-only N3 gateway. Deny-by-default: only GETs to a small explicit
// endpoint allowlist are permitted. Never reachable from the browser except
// through the specific /api/n3/probe/:name route.

const MAIN_BASE = process.env.OPEN_API_BASE_URL ?? "https://openapi.account.qne.cloud";

const N3_TIMEOUT_MS = 15_000;

export type ProbeName = "companyprofile" | "customers" | "stocks";

// Fixed, GET-only allowlist for Milestone 1.0.1.
// Extending this list is a milestone decision, not a runtime concern.
const PROBES: Record<ProbeName, { path: string; label: string; description: string }> = {
  companyprofile: {
    path: "/api/companyprofile/BasicInfo",
    label: "Company profile — BasicInfo",
    description: "Confirms authenticated identity, tenant code and company name from N3.",
  },
  customers: {
    path: "/api/customers/list?$top=5&$skip=0",
    label: "Customers — list (top 5)",
    description: "Confirms authenticated read access to the customer master list.",
  },
  stocks: {
    path: "/api/stocks/list?$top=5&$skip=0",
    label: "Stock codes — list (top 5)",
    description: "Confirms authenticated read access to stock/service codes.",
  },
};

export function listProbes() {
  return (Object.keys(PROBES) as ProbeName[]).map((name) => ({
    name,
    label: PROBES[name].label,
    description: PROBES[name].description,
  }));
}

export function isProbeName(v: unknown): v is ProbeName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PROBES, v);
}

/**
 * Perform a raw, authenticated GET against a specific N3 open-api path.
 * Only for internal server-side callers (session bootstrap). Does NOT accept
 * arbitrary browser input; callers must pass a hard-coded path constant.
 *
 * `opts.timeoutMs` is an internal, server-only bound used by latency-critical
 * callers (ownership resolution). It never widens the default and is not
 * reachable from the browser or from probe handling.
 */
export async function callN3Path(
  token: string,
  path: string,
  opts?: { timeoutMs?: number },
): Promise<{ status: number; body: unknown; durationMs: number }> {
  if (!path.startsWith("/api/")) {
    throw new Error("callN3Path: path must be under /api/");
  }
  if (path.includes("..") || path.includes("://")) {
    throw new Error("callN3Path: unsafe path");
  }
  const requested = opts?.timeoutMs;
  const timeoutMs =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.min(requested, N3_TIMEOUT_MS)
      : N3_TIMEOUT_MS;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const started = Date.now();
  try {
    const res = await fetch(MAIN_BASE + path, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    return { status: res.status, body, durationMs: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Run a named probe from the fixed allowlist. This is the ONLY code path
 * browsers can trigger through /api/n3/probe/:name.
 */
export async function runProbe(
  token: string,
  name: ProbeName,
): Promise<{ status: number; body: unknown; durationMs: number }> {
  const probe = PROBES[name];
  if (!probe) throw new Error("Unknown probe");
  return callN3Path(token, probe.path);
}

// ---- List access (Milestone 1.0.2) --------------------------------------
// Only the two verified list endpoints, GET-only, bounded pagination. No
// arbitrary paths are ever accepted from the browser: callers pass only
// `top`/`skip` and (optionally) an in-memory page filter substring.

const MAX_TOP = 100;
const DEFAULT_TOP = 25;

export function boundedPagination(input: { top?: unknown; skip?: unknown }): {
  top: number;
  skip: number;
} {
  const rawTop = Number(input.top);
  const rawSkip = Number(input.skip);
  const top =
    Number.isFinite(rawTop) && rawTop > 0 ? Math.min(Math.floor(rawTop), MAX_TOP) : DEFAULT_TOP;
  const skip = Number.isFinite(rawSkip) && rawSkip >= 0 ? Math.floor(rawSkip) : 0;
  return { top, skip };
}

function safeString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const s = safeString(row[k]);
    if (s) return s;
  }
  return null;
}

function pickBool(row: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
    }
    if (typeof v === "number") return v !== 0;
  }
  return null;
}

/**
 * Extract a page from the real N3 envelope. Priority:
 *   1. data.value / data.count   (verified production contract)
 *   2. data.Value / data.Count   (casing-tolerant fallback)
 *   3. data.items / data.Items   (compatibility fallback)
 *   4. data as array             (compatibility fallback)
 *   5. top-level value / items   (compatibility fallback)
 *   6. anything else             ({ items: [], total: null })
 *
 * When the envelope has a `code` field, only "0000" is treated as a
 * successful page. Any other code returns an empty page (never throws).
 */
export function extractPage(body: unknown): { items: unknown[]; total: number | null } {
  if (!body || typeof body !== "object") return { items: [], total: null };
  const b = body as Record<string, unknown>;
  const codeField = b.code ?? b.Code;
  if (typeof codeField === "string" && codeField && codeField !== "0000") {
    return { items: [], total: null };
  }
  const data = b.data ?? b.Data;

  function coerceTotal(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return null;
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const value = d.value ?? d.Value;
    if (Array.isArray(value)) return { items: value, total: coerceTotal(d.count ?? d.Count) };
    const items = d.items ?? d.Items;
    if (Array.isArray(items)) return { items, total: coerceTotal(d.count ?? d.Count) };
  }
  if (Array.isArray(data)) return { items: data, total: null };
  if (Array.isArray(b.value)) return { items: b.value, total: coerceTotal(b.count) };
  if (Array.isArray(b.items)) return { items: b.items, total: coerceTotal(b.count) };
  return { items: [], total: null };
}

export type N3CustomerSummary = { id: string; code: string; name: string | null };
export type N3StockSummary = {
  id: string;
  code: string;
  name: string | null;
  isActive: boolean | null;
};

export type N3ListPage<T> = {
  status: number;
  items: T[];
  total: number | null;
  top: number;
  skip: number;
  hasMore: boolean;
  durationMs: number;
};

function computeHasMore(
  total: number | null,
  skip: number,
  top: number,
  returned: number,
): boolean {
  if (typeof total === "number") return skip + returned < total;
  // Unknown total: assume more only if the page came back full.
  return returned >= top && returned > 0;
}

export async function listN3Customers(
  token: string,
  opts: { top?: unknown; skip?: unknown; filter?: unknown } = {},
): Promise<N3ListPage<N3CustomerSummary>> {
  const { top, skip } = boundedPagination(opts);
  const path = `/api/customers/list?$top=${top}&$skip=${skip}`;
  const res = await callN3Path(token, path);
  const page = extractPage(res.body);
  const filterStr = typeof opts.filter === "string" ? opts.filter.trim().toLowerCase() : "";
  const items: N3CustomerSummary[] = [];
  for (const raw of page.items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = pickString(row, ["Id", "id", "CustomerId", "customerId", "Guid", "guid"]);
    const code = pickString(row, ["Code", "code", "CustomerCode", "customerCode"]);
    if (!id || !code) continue;
    const name = pickString(row, ["Name", "name", "CustomerName", "customerName", "Description"]);
    if (filterStr) {
      const hay = `${code} ${name ?? ""}`.toLowerCase();
      if (!hay.includes(filterStr)) continue;
    }
    items.push({ id, code, name });
  }
  return {
    status: res.status,
    items,
    total: page.total,
    top,
    skip,
    hasMore: computeHasMore(page.total, skip, top, page.items.length),
    durationMs: res.durationMs,
  };
}

export async function listN3Stocks(
  token: string,
  opts: { top?: unknown; skip?: unknown; filter?: unknown } = {},
): Promise<N3ListPage<N3StockSummary>> {
  const { top, skip } = boundedPagination(opts);
  const path = `/api/stocks/list?$top=${top}&$skip=${skip}`;
  const res = await callN3Path(token, path);
  const page = extractPage(res.body);
  const filterStr = typeof opts.filter === "string" ? opts.filter.trim().toLowerCase() : "";
  const items: N3StockSummary[] = [];
  for (const raw of page.items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = pickString(row, ["Id", "id", "StockId", "stockId", "Guid", "guid"]);
    const code = pickString(row, ["Code", "code", "StockCode", "stockCode"]);
    if (!id || !code) continue;
    const name = pickString(row, ["Description", "description", "Name", "name", "StockName"]);
    const isActive = pickBool(row, ["IsActive", "isActive", "Active", "active"]);
    if (filterStr) {
      const hay = `${code} ${name ?? ""}`.toLowerCase();
      if (!hay.includes(filterStr)) continue;
    }
    items.push({ id, code, name, isActive });
  }
  return {
    status: res.status,
    items,
    total: page.total,
    top,
    skip,
    hasMore: computeHasMore(page.total, skip, top, page.items.length),
    durationMs: res.durationMs,
  };
}

// Safety cap for full-list verification scans. The verified customer
// tenant already carries >1,400 records, so 500 is unsafe. 5,000 provides
// headroom without unbounded paging.
const VERIFY_SAFETY_CAP = 5000;

export type VerifyResult<T> =
  | { status: "found"; item: T }
  | { status: "not_found" }
  | { status: "unauthorized" }
  | { status: "unavailable" }
  | { status: "limit_reached" };

async function verifyByCodePaged<T extends { code: string }>(
  fetcher: (opts: { top: number; skip: number }) => Promise<N3ListPage<T>>,
  code: string,
): Promise<VerifyResult<T>> {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return { status: "not_found" };
  let skip = 0;
  const top = MAX_TOP;
  while (skip < VERIFY_SAFETY_CAP) {
    let page: N3ListPage<T>;
    try {
      page = await fetcher({ top, skip });
    } catch {
      return { status: "unavailable" };
    }
    if (page.status === 401) return { status: "unauthorized" };
    if (page.status < 200 || page.status >= 300) return { status: "unavailable" };
    const hit = page.items.find((x) => x.code.trim().toUpperCase() === wanted);
    if (hit) return { status: "found", item: hit };
    if (!page.hasMore) return { status: "not_found" };
    skip += top;
  }
  return { status: "limit_reached" };
}

export function verifyN3CustomerByCode(
  token: string,
  code: string,
): Promise<VerifyResult<N3CustomerSummary>> {
  return verifyByCodePaged<N3CustomerSummary>((o) => listN3Customers(token, o), code);
}

export function verifyN3StockByCode(
  token: string,
  code: string,
): Promise<VerifyResult<N3StockSummary>> {
  return verifyByCodePaged<N3StockSummary>((o) => listN3Stocks(token, o), code);
}

// ---- Global list access (Milestone 1.0.2 — Correction B) ---------------
// Full-tenant Customer/Stock fetch so the UI can search the ENTIRE list
// (not just the currently displayed N3 page). Server-only; only exposed
// through Owner-authorized fixed endpoints.

export type N3GlobalError =
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "incomplete"
  | "limit_reached";
export class N3ListError extends Error {
  constructor(public code: N3GlobalError) {
    super(code);
  }
}

const FULL_LIST_TOP = 100;
const FULL_LIST_CAP = 10_000;
const FULL_LIST_CONCURRENCY = 3;

function dedupeById<T extends { id: string; code: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.id || it.code;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function fetchAllPages<T extends { id: string; code: string }>(
  fetcher: (opts: { top: number; skip: number }) => Promise<N3ListPage<T>>,
  hooks?: { onActive?: (active: number) => void },
): Promise<{ items: T[]; total: number; pagesFetched: number }> {
  let first: N3ListPage<T>;
  try {
    first = await fetcher({ top: FULL_LIST_TOP, skip: 0 });
  } catch {
    throw new N3ListError("unavailable");
  }
  if (first.status === 401) throw new N3ListError("unauthorized");
  if (first.status < 200 || first.status >= 300) throw new N3ListError("unavailable");
  const rawTotal = typeof first.total === "number" ? first.total : first.items.length;
  const total = Math.min(rawTotal, FULL_LIST_CAP);
  const remaining: number[] = [];
  for (let s = FULL_LIST_TOP; s < total; s += FULL_LIST_TOP) remaining.push(s);
  const pageResults: T[][] = new Array(remaining.length);

  let active = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= remaining.length) return;
      active++;
      hooks?.onActive?.(active);
      try {
        let page: N3ListPage<T>;
        try {
          page = await fetcher({ top: FULL_LIST_TOP, skip: remaining[i] });
        } catch {
          throw new N3ListError("incomplete");
        }
        if (page.status === 401) throw new N3ListError("unauthorized");
        if (page.status < 200 || page.status >= 300) throw new N3ListError("incomplete");
        pageResults[i] = page.items;
      } finally {
        active--;
      }
    }
  };
  const workerCount = Math.min(FULL_LIST_CONCURRENCY, Math.max(1, remaining.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  // Order-preserving merge of the sequential first page + parallel remaining pages.
  const merged: T[] = [...first.items];
  for (const chunk of pageResults) if (chunk) merged.push(...chunk);
  return { items: dedupeById(merged), total, pagesFetched: 1 + remaining.length };
}

export function listAllN3Customers(token: string, hooks?: { onActive?: (active: number) => void }) {
  return fetchAllPages<N3CustomerSummary>((o) => listN3Customers(token, o), hooks);
}
export function listAllN3Stocks(token: string, hooks?: { onActive?: (active: number) => void }) {
  return fetchAllPages<N3StockSummary>((o) => listN3Stocks(token, o), hooks);
}

// ---- Search normalization (Correction B) --------------------------------
// Re-exported from the browser-safe module for server-side callers.
export { normalizeSearchText, matchesQuery } from "./n3-gateway.browser";

const DEV_KEY_TIMEOUT_MS = 10_000;

/**
 * Dev-only: exchange an N3 API key for a JWT via the official connect
 * endpoint. The API key never leaves this function — no logging, no
 * persistence, no client return value.
 */
export async function exchangeApiKey(
  apiKey: string,
): Promise<{ token: string; expiration?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEV_KEY_TIMEOUT_MS);
  try {
    const url = `${MAIN_BASE}/api/auth/connect?api-key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, { method: "GET", signal: controller.signal });
    const envelope = (await upstream.json().catch(() => null)) as {
      code?: string;
      message?: string;
      data?: { token?: string; expiration?: string };
    } | null;
    if (!upstream.ok || !envelope || envelope.code !== "0000" || !envelope.data?.token) {
      throw new Error(envelope?.message ?? "N3 connect failed");
    }
    return { token: envelope.data.token, expiration: envelope.data.expiration };
  } finally {
    clearTimeout(t);
  }
}

// ---- HH-GOLIVE-01A — Output Tax code and Unit-of-measure read contracts ----
//
// Exactly two additional hard-coded, read-only GET contracts are permitted:
//   GET /api/TaxCodes/OutputTax/Query?$top=&$skip=
//   GET /api/UOMs/Query?$top=&$skip=
// Nothing here probes or accepts an arbitrary N3 path, and neither list is
// ever written to. Raw upstream DTOs never leave this module: only sanitized
// summaries are returned, and the browser only ever sees {id, code, name}.

export const N3_TAX_CODE_PATH = "/api/TaxCodes/OutputTax/Query";
export const N3_UOM_PATH = "/api/UOMs/Query";

/**
 * Strict reading of the documented N3 success envelope.
 *
 * A page is only accepted when the envelope explicitly declares success
 * (`code === "0000"` or `success === true`) AND carries `data.value` as an
 * array. Anything else — a non-success code, a missing envelope, a malformed
 * body — is rejected so callers fail closed instead of treating a broken
 * response as "no rows".
 */
export type N3StrictPage = { ok: true; items: unknown[]; total: number | null } | { ok: false };

export function extractStrictPage(body: unknown): N3StrictPage {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const code = b.code ?? b.Code;
  const success = b.success ?? b.Success;
  // An explicit code governs: only "0000" declares success. `success: true` is
  // a fallback declaration used ONLY when no code field is present, so a
  // contradictory `{ code: "9999", success: true }` fails closed.
  const declaredOk =
    code === undefined || code === null
      ? success === true
      : typeof code === "string" && code === "0000";
  if (!declaredOk) return { ok: false };

  const data = b.data ?? b.Data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
  const d = data as Record<string, unknown>;
  const value = d.value ?? d.Value;
  if (!Array.isArray(value)) return { ok: false };
  const rawCount = d.count ?? d.Count;
  let total: number | null = null;
  if (typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount >= 0) {
    total = Math.floor(rawCount);
  } else if (typeof rawCount === "string" && rawCount.trim() !== "") {
    const n = Number(rawCount);
    if (Number.isFinite(n) && n >= 0) total = Math.floor(n);
  }
  return { ok: true, items: value, total };
}

/**
 * Sanitized Output Tax code.
 *
 * `postingAccountId` (and every other N3 account field) is deliberately NOT
 * carried: HotelHub never lets an upstream posting account reach the browser.
 * `rateBp` is the normalized live N3 rate in basis points, or null when N3
 * declares no usable rate.
 */
export type N3TaxCodeSummary = {
  id: string;
  code: string;
  name: string | null;
  isActive: boolean | null;
  isOutputTax: boolean | null;
  rateBp: number | null;
};


/** Sanitized unit of measure. `stockId` stays server-side for filtering. */
export type N3UomSummary = {
  id: string;
  code: string;
  name: string | null;
  isActive: boolean | null;
  stockId: string | null;
};

export function mapN3TaxCodeRow(raw: unknown): N3TaxCodeSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = pickString(row, ["Id", "id", "TaxCodeId", "taxCodeId", "Guid", "guid"]);
  const code = pickString(row, ["Code", "code", "TaxCode", "taxCode"]);
  if (!id || !code) return null;
  return {
    id,
    code,
    name: pickString(row, ["Description", "description", "Name", "name"]),
    isActive: pickBool(row, ["IsActive", "isActive", "Active", "active"]),
    isOutputTax: pickBool(row, ["IsOutputTax", "isOutputTax", "OutputTax", "outputTax"]),
  };
}

export function mapN3UomRow(raw: unknown): N3UomSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = pickString(row, ["Id", "id", "UOMId", "uomId", "UomId", "Guid", "guid"]);
  const code = pickString(row, ["Code", "code", "UOM", "uom", "Uom", "UOMCode", "uomCode"]);
  if (!id || !code) return null;
  return {
    id,
    code,
    name: pickString(row, ["Description", "description", "Name", "name"]),
    isActive: pickBool(row, ["IsActive", "isActive", "Active", "active"]),
    stockId: pickString(row, ["StockId", "stockId", "StockID", "stockID", "Stock_Id"]),
  };
}

/** Hard bound on how many pages a single full-list read may ever request. */
export const STRICT_LIST_MAX_PAGES = 100;

/**
 * Bounded, fail-closed full-list read of one proven query endpoint.
 *
 * Any non-2xx status, non-success envelope, malformed envelope, transport
 * failure or page cap breach throws `N3ListError`, so no caller can mistake a
 * partial or broken read for a complete list.
 */
export async function listAllStrictN3<T>(
  token: string,
  path: string,
  map: (raw: unknown) => T | null,
): Promise<{ items: T[]; total: number }> {
  const out: T[] = [];
  let skip = 0;
  let pages = 0;
  let rawCount = 0;
  let total: number | null = null;
  for (;;) {
    if (pages >= STRICT_LIST_MAX_PAGES) throw new N3ListError("limit_reached");
    if (skip >= FULL_LIST_CAP) throw new N3ListError("limit_reached");
    const first = pages === 0;
    let res: { status: number; body: unknown; durationMs: number };
    try {
      res = await callN3Path(token, `${path}?$top=${FULL_LIST_TOP}&$skip=${skip}`);
    } catch {
      throw new N3ListError(first ? "unavailable" : "incomplete");
    }
    if (res.status === 401) throw new N3ListError("unauthorized");
    if (res.status === 403) throw new N3ListError("forbidden");
    if (res.status < 200 || res.status >= 300) {
      throw new N3ListError(first ? "unavailable" : "incomplete");
    }
    const page = extractStrictPage(res.body);
    if (!page.ok) throw new N3ListError(first ? "unavailable" : "incomplete");
    if (first) {
      total = page.total;
      // A declared total beyond the hard cap is never silently truncated.
      if (typeof total === "number" && total > FULL_LIST_CAP) {
        throw new N3ListError("limit_reached");
      }
    } else if (typeof page.total === "number" && page.total !== total) {
      // The upstream total changed mid-read: the list is not a consistent set.
      throw new N3ListError("incomplete");
    }

    const returned = page.items.length;
    if (typeof total === "number") {
      const expected = Math.min(FULL_LIST_TOP, Math.max(0, total - rawCount));
      // Short, empty or oversized pages against a known total are incomplete.
      if (returned !== expected) throw new N3ListError("incomplete");
    } else if (returned > FULL_LIST_TOP) {
      throw new N3ListError("incomplete");
    }

    for (const raw of page.items) {
      const mapped = map(raw);
      if (mapped) out.push(mapped);
    }
    rawCount += returned;
    pages++;
    skip += FULL_LIST_TOP;

    if (typeof total === "number") {
      // Completeness is measured on RAW upstream rows, not mapped output.
      if (rawCount === total) break;
      if (rawCount > total) throw new N3ListError("incomplete");
    } else if (returned < FULL_LIST_TOP) {
      break;
    }
  }
  return { items: out, total: typeof total === "number" ? total : rawCount };
}

/** Complete Output Tax code list. Fails closed; never partial. */
export function listAllN3TaxCodes(token: string) {
  return listAllStrictN3<N3TaxCodeSummary>(token, N3_TAX_CODE_PATH, mapN3TaxCodeRow);
}

/** Complete unit-of-measure list. Fails closed; never partial. */
export function listAllN3Uoms(token: string) {
  return listAllStrictN3<N3UomSummary>(token, N3_UOM_PATH, mapN3UomRow);
}
