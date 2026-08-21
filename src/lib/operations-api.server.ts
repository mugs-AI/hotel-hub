// Shared guards + error mapping for the reservation-operation API routes
// (HotelHub Run 5D2.1). Pure/deterministic helpers so they can be unit tested
// without a request context.

export const OPERATION_BODY_LIMIT = 8 * 1024;

export function deny(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** Reject cross-site writes: these endpoints are only ever called by the app. */
export function isSameOriginWrite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return Boolean(site); // no Origin and no Sec-Fetch-Site → reject
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject unknown top-level fields; returns the offending key or null. */
export function rejectUnknown(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) return k;
  return null;
}

export type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: "body_too_large" | "invalid_json" | "invalid_body" };

/** Read a size-capped JSON object body. Never surfaces parser details. */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > OPERATION_BODY_LIMIT) {
    return { ok: false, code: "body_too_large" };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, code: "invalid_body" };
  }
  if (text.length > OPERATION_BODY_LIMIT) return { ok: false, code: "body_too_large" };
  if (!text.trim()) return { ok: true, body: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (!isPlainObject(parsed)) return { ok: false, code: "invalid_body" };
  return { ok: true, body: parsed };
}

/** Map a stable operation error code onto a meaningful HTTP status. */
export function statusForOperationError(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "policy_denied":
      return 403;
    case "reservation_not_found":
    case "operation_not_found":
    case "room_not_found":
    case "guest_not_found":
      return 404;
    case "invalid_transition":
    case "reservation_changed":
    case "operation_stale":
    case "operation_pending":
    case "early_check_in_required":
    case "room_unavailable":
    case "room_capacity_exceeded":
    case "primary_guest_required":
    case "guest_assignment_required":
    case "idempotency_conflict":
    case "housekeeping_not_initialized":
    case "room_not_ready":
    case "dnd_active":
    case "destination_housekeeping_not_initialized":
    case "destination_room_not_ready":
    case "destination_dnd_active":
    case "illegal_transition":
    case "room_not_occupied":
    case "cleaning_in_progress":
      return 409;

    case "validation_failed":
    case "invalid_id":
    case "invalid_json":
    case "invalid_body":
    case "unknown_field":
    case "late_checkout_out_of_range":
    case "late_checkout_not_later":
    case "operation_immutable_field":
      return 400;
    case "body_too_large":
      return 413;
    default:
      return 500;
  }
}
