// Helper — decode the middle segment of a JWT to extract claims (email, sub,
// tenant hints). Server-only; signature is not verified because N3 will
// re-verify on every subsequent call.
export function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split(".");
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
