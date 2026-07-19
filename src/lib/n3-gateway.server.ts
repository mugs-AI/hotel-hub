// Server-only N3 gateway. Deny-by-default: only GETs to a small explicit
// endpoint allowlist are permitted. Never reachable from the browser except
// through the specific /api/n3/probe/:name route.

const MAIN_BASE =
  process.env.OPEN_API_BASE_URL ?? "https://openapi.account.qne.cloud";

const N3_TIMEOUT_MS = 15_000;

export type ProbeName = "companyprofile" | "customers" | "stocks";

// Fixed, GET-only allowlist for Milestone 1.0.1.
// Extending this list is a milestone decision, not a runtime concern.
const PROBES: Record<
  ProbeName,
  { path: string; label: string; description: string }
> = {
  companyprofile: {
    path: "/api/companyprofile/BasicInfo",
    label: "Company profile — BasicInfo",
    description:
      "Confirms authenticated identity, tenant code and company name from N3.",
  },
  customers: {
    path: "/api/customers/list?$top=5&$skip=0",
    label: "Customers — list (top 5)",
    description:
      "Confirms authenticated read access to the customer master list.",
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
    const envelope = (await upstream.json().catch(() => null)) as
      | { code?: string; message?: string; data?: { token?: string; expiration?: string } }
      | null;
    if (!upstream.ok || !envelope || envelope.code !== "0000" || !envelope.data?.token) {
      throw new Error(envelope?.message ?? "N3 connect failed");
    }
    return { token: envelope.data.token, expiration: envelope.data.expiration };
  } finally {
    clearTimeout(t);
  }
}
