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
 */
export async function callN3Path(
  token: string,
  path: string,
): Promise<{ status: number; body: unknown; durationMs: number }> {
  if (!path.startsWith("/api/")) {
    throw new Error("callN3Path: path must be under /api/");
  }
  if (path.includes("..") || path.includes("://")) {
    throw new Error("callN3Path: unsafe path");
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), N3_TIMEOUT_MS);
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

function computeHasMore(total: number | null, skip: number, top: number, returned: number): boolean {
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
  return verifyByCodePaged<N3CustomerSummary>(
    (o) => listN3Customers(token, o),
    code,
  );
}

export function verifyN3StockByCode(
  token: string,
  code: string,
): Promise<VerifyResult<N3StockSummary>> {
  return verifyByCodePaged<N3StockSummary>((o) => listN3Stocks(token, o), code);
}


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
