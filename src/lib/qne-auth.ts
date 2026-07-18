// Single place that touches localStorage for the N3 JWT.
// Only the JWT (and optional expiration) are persisted. Company / tenant /
// email are always re-fetched from N3 — never cached in browser storage.

export const QNE_TOKEN_KEY = "qne_access_token";
export const QNE_TOKEN_EXPIRATION_KEY = "qne_token_expiration";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(QNE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string, expiration?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QNE_TOKEN_KEY, token);
    if (expiration) {
      window.localStorage.setItem(QNE_TOKEN_EXPIRATION_KEY, expiration);
    }
  } catch {
    /* ignore */
  }
}

export function clearStoredToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QNE_TOKEN_KEY);
    window.localStorage.removeItem(QNE_TOKEN_EXPIRATION_KEY);
  } catch {
    /* ignore */
  }
}

// Decode the middle segment of the JWT for DISPLAY ONLY. Never trust these
// values for authorization — the server verifies the signature on every call.
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Unwrap the standard N3 ApiResponse envelope.
export function unwrapApiResponse<T = unknown>(body: {
  code?: string;
  data?: T;
  message?: string;
}): T {
  if (body?.code !== "0000") {
    throw new Error(body?.message ?? "N3 API error");
  }
  return body.data as T;
}

export function unwrapPageList<T>(data: { count?: number; value?: T[] } | null | undefined) {
  return { rows: data?.value ?? [], total: data?.count ?? 0 };
}
