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

function extractItems(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const data = b.data ?? b.Data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const inner =
      (data as Record<string, unknown>).items ?? (data as Record<string, unknown>).Items;
    if (Array.isArray(inner)) return inner;
  }
  if (Array.isArray(b.items)) return b.items;
  return [];
}

export type N3CustomerSummary = { id: string; code: string; name: string | null };
export type N3StockSummary = {
  id: string;
  code: string;
  name: string | null;
  isActive: boolean | null;
};

export async function listN3Customers(
  token: string,
  opts: { top?: unknown; skip?: unknown; filter?: unknown } = {},
): Promise<{
  status: number;
  items: N3CustomerSummary[];
  top: number;
  skip: number;
  durationMs: number;
}> {
  const { top, skip } = boundedPagination(opts);
  const path = `/api/customers/list?$top=${top}&$skip=${skip}`;
  const res = await callN3Path(token, path);
  const filterStr = typeof opts.filter === "string" ? opts.filter.trim().toLowerCase() : "";
  const items: N3CustomerSummary[] = [];
  for (const raw of extractItems(res.body)) {
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
  return { status: res.status, items, top, skip, durationMs: res.durationMs };
}

export async function listN3Stocks(
  token: string,
  opts: { top?: unknown; skip?: unknown; filter?: unknown } = {},
): Promise<{
  status: number;
  items: N3StockSummary[];
  top: number;
  skip: number;
  durationMs: number;
}> {
  const { top, skip } = boundedPagination(opts);
  const path = `/api/stocks/list?$top=${top}&$skip=${skip}`;
  const res = await callN3Path(token, path);
  const filterStr = typeof opts.filter === "string" ? opts.filter.trim().toLowerCase() : "";
  const items: N3StockSummary[] = [];
  for (const raw of extractItems(res.body)) {
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
  return { status: res.status, items, top, skip, durationMs: res.durationMs };
}

/**
 * Verify a single N3 customer by code exists for the authenticated tenant.
 * Returns the canonical summary or null. Used before persisting the
 * walk-in customer mapping — never trust browser-supplied name/id.
 */
export async function verifyN3CustomerByCode(
  token: string,
  code: string,
): Promise<N3CustomerSummary | null> {
  // N3 filter syntax is not independently verified in this repo, so we scan
  // pages via bounded pagination and match by code.
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  for (let skip = 0; skip < 500; skip += MAX_TOP) {
    const page = await listN3Customers(token, { top: MAX_TOP, skip });
    if (page.status < 200 || page.status >= 300) return null;
    const hit = page.items.find((c) => c.code.trim().toUpperCase() === wanted);
    if (hit) return hit;
    if (page.items.length < MAX_TOP) return null;
  }
  return null;
}

export async function verifyN3StockByCode(
  token: string,
  code: string,
): Promise<N3StockSummary | null> {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  for (let skip = 0; skip < 2000; skip += MAX_TOP) {
    const page = await listN3Stocks(token, { top: MAX_TOP, skip });
    if (page.status < 200 || page.status >= 300) return null;
    const hit = page.items.find((s) => s.code.trim().toUpperCase() === wanted);
    if (hit) return hit;
    if (page.items.length < MAX_TOP) return null;
  }
  return null;
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
