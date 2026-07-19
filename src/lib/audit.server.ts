// Server-only audit log. Never accepts N3 tokens or API keys in `detail`.
export type AuditEventType =
  | "session.launch.success"
  | "session.launch.failure"
  | "session.dev_connect.success"
  | "session.dev_connect.failure"
  | "session.destroyed"
  | "session.n3_401"
  | "access.denied"
  | "probe.executed"
  | "probe.denied"
  | "role.assigned"
  | "role.revoked";

const SENSITIVE_KEYS = new Set([
  "token",
  "access_token",
  "apiKey",
  "api_key",
  "authorization",
  "password",
  "secret",
]);

function sanitize(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (SENSITIVE_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function logAudit(input: {
  tenantId?: string | null;
  n3UserKey?: string | null;
  eventType: AuditEventType;
  detail?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("hotel_audit_events").insert({
      tenant_id: input.tenantId ?? null,
      n3_user_key: input.n3UserKey ?? null,
      event_type: input.eventType,
      // Cast: sanitized values are JSON-serializable but not typed as the
      // generated `Json` union.
      detail: sanitize(input.detail ?? {}) as unknown as never,
      ip: input.ip ?? null,
    });
  } catch (err) {
    // Never let audit failures break the request.
    console.error("[audit] insert failed", (err as Error).message);
  }
}
