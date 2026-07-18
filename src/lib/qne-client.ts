// Frontend HTTP client. Only talks to same-origin /api/* — never to
// openapi.account.qne.cloud directly.
import { getStoredToken, clearStoredToken } from "./qne-auth";

export class QneAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function qneFetch(
  host: "main" | "reporting",
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getStoredToken();
  if (!token) throw new QneAuthError(401, "Not signed in");
  const clean = path.startsWith("/") ? path : "/" + path;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`/api/proxy/${host}${clean}`, { ...init, headers });
  if (res.status === 401) {
    clearStoredToken();
    throw new QneAuthError(401, "Session expired");
  }
  return res;
}

export async function qneJson<T = unknown>(
  host: "main" | "reporting",
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await qneFetch(host, path, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body as { message?: string; error?: string } | null)?.message ??
      (body as { message?: string; error?: string } | null)?.error ??
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}
