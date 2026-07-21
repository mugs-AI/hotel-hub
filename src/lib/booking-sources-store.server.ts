/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only tenant-scoped store for booking sources. All operations
// require an explicit tenantId supplied by the trusted server context —
// this module never trusts request input.

export type BookingSource = {
  id: string;
  tenantId: string;
  sourceCode: string;
  displayName: string;
  isActive: boolean;
  sortOrder: number;
};

type Row = {
  id: string;
  tenant_id: string;
  source_code: string;
  display_name: string;
  is_active: boolean;
  sort_order: number;
};

function toDto(row: Row): BookingSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceCode: row.source_code,
    displayName: row.display_name,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

const CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
export const NAME_MAX = 60;

export function isSourceCodeFormat(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

/** Deterministically derive a snake_case source_code from a display name. */
export function slugifyDisplayName(name: string): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;
  let s = trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // Must start with a letter — strip leading digits.
  s = s.replace(/^[0-9_]+/, "");
  if (!s) return null;
  s = s.slice(0, 48);
  return CODE_RE.test(s) ? s : null;
}

async function admin(): Promise<{ from: (t: string) => any }> {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  return _sa as unknown as { from: (t: string) => any };
}

export async function listBookingSources(
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<BookingSource[]> {
  const supa = await admin();
  let q = supa
    .from("hotel_booking_sources")
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .eq("tenant_id", tenantId);
  if (opts.activeOnly) q = q.eq("is_active", true);
  const res = await q.order("sort_order", { ascending: true });
  if (res.error) throw new Error(`booking_sources read failed`);
  return (res.data as Row[] | null | undefined)?.map(toDto) ?? [];
}

/** Lookup a single source by code within a tenant. Returns null if absent. */
export async function findBookingSourceByCode(
  tenantId: string,
  sourceCode: string,
): Promise<BookingSource | null> {
  const supa = await admin();
  const res = await supa
    .from("hotel_booking_sources")
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("source_code", sourceCode)
    .maybeSingle();
  if (res.error) throw new Error("booking_sources read failed");
  return res.data ? toDto(res.data as Row) : null;
}

export type CreateSourceInput = {
  tenantId: string;
  displayName: string;
  sourceCode?: string | null;
};

export type UpdateSourceInput = {
  tenantId: string;
  id: string;
  displayName?: string;
  isActive?: boolean;
  direction?: "up" | "down";
};

export class BookingSourceError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "BookingSourceError";
  }
}

export async function createBookingSource(input: CreateSourceInput): Promise<BookingSource> {
  const supa = await admin();
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new BookingSourceError("display_name_required");
  if (displayName.length > NAME_MAX) throw new BookingSourceError("display_name_too_long");

  let code = (input.sourceCode ?? "").trim().toLowerCase();
  if (!code) {
    const derived = slugifyDisplayName(displayName);
    if (!derived) throw new BookingSourceError("invalid_source_code");
    code = derived;
  }
  if (!isSourceCodeFormat(code)) throw new BookingSourceError("invalid_source_code");

  // Determine next sort_order (max + 10, defaulting to 10).
  const existing = await supa
    .from("hotel_booking_sources")
    .select("sort_order")
    .eq("tenant_id", input.tenantId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existing.error) throw new BookingSourceError("booking_source_create_failed");
  const rows = (existing.data ?? []) as Array<{ sort_order: number }>;
  const nextOrder = rows.length > 0 ? Number(rows[0].sort_order) + 10 : 10;

  const inserted = await supa
    .from("hotel_booking_sources")
    .insert({
      tenant_id: input.tenantId,
      source_code: code,
      display_name: displayName,
      is_active: true,
      sort_order: nextOrder,
    })
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .single();
  if (inserted.error) {
    const msg = String(inserted.error.message ?? "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      if (msg.includes("source_code")) throw new BookingSourceError("duplicate_source_code");
      if (msg.includes("display_name")) throw new BookingSourceError("duplicate_display_name");
      throw new BookingSourceError("duplicate_source");
    }
    throw new BookingSourceError("booking_source_create_failed");
  }
  return toDto(inserted.data as Row);
}

export async function updateBookingSource(input: UpdateSourceInput): Promise<BookingSource> {
  const supa = await admin();
  // Read current row (tenant scoped).
  const current = await supa
    .from("hotel_booking_sources")
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (current.error) throw new BookingSourceError("booking_source_update_failed");
  if (!current.data) throw new BookingSourceError("not_found");
  const row = current.data as Row;

  // Reorder is a swap with the neighbour (up/down) — sort_order gaps of 10.
  if (input.direction) {
    const asc = input.direction === "down";
    let q = supa
      .from("hotel_booking_sources")
      .select("id, sort_order")
      .eq("tenant_id", input.tenantId);
    q = asc ? q.gt("sort_order", row.sort_order) : q.lt("sort_order", row.sort_order);
    const neighbourRes = await q
      .order("sort_order", { ascending: asc })
      .limit(1);
    if (neighbourRes.error) throw new BookingSourceError("booking_source_update_failed");
    const neigh = (neighbourRes.data ?? [])[0] as { id: string; sort_order: number } | undefined;
    if (!neigh) throw new BookingSourceError("cannot_reorder");
    // Swap sort_orders via a temporary large value to avoid unique clash (no
    // unique on sort_order in schema, but we play safe).
    const tempOrder = row.sort_order + neigh.sort_order + 1_000_000;
    const s1 = await supa
      .from("hotel_booking_sources")
      .update({ sort_order: tempOrder })
      .eq("tenant_id", input.tenantId)
      .eq("id", row.id);
    if (s1.error) throw new BookingSourceError("booking_source_update_failed");
    const s2 = await supa
      .from("hotel_booking_sources")
      .update({ sort_order: row.sort_order })
      .eq("tenant_id", input.tenantId)
      .eq("id", neigh.id);
    if (s2.error) throw new BookingSourceError("booking_source_update_failed");
    const s3 = await supa
      .from("hotel_booking_sources")
      .update({ sort_order: neigh.sort_order })
      .eq("tenant_id", input.tenantId)
      .eq("id", row.id);
    if (s3.error) throw new BookingSourceError("booking_source_update_failed");
    return { ...toDto(row), sortOrder: neigh.sort_order };
  }

  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) {
    const dn = input.displayName.trim();
    if (!dn) throw new BookingSourceError("display_name_required");
    if (dn.length > NAME_MAX) throw new BookingSourceError("display_name_too_long");
    patch.display_name = dn;
  }
  if (input.isActive !== undefined) {
    patch.is_active = input.isActive === true;
  }
  if (Object.keys(patch).length === 0) throw new BookingSourceError("no_valid_fields");

  const updated = await supa
    .from("hotel_booking_sources")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.id)
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .single();
  if (updated.error) {
    const msg = String(updated.error.message ?? "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique"))
      throw new BookingSourceError("duplicate_display_name");
    if (msg.includes("source_code"))
      // Code-immutability trigger fired — should not happen since we never patch source_code.
      throw new BookingSourceError("source_code_immutable");
    throw new BookingSourceError("booking_source_update_failed");
  }
  return toDto(updated.data as Row);
}

export const BOOKING_SOURCE_ERROR_CODES = new Set<string>([
  "display_name_required",
  "display_name_too_long",
  "invalid_source_code",
  "duplicate_source_code",
  "duplicate_display_name",
  "duplicate_source",
  "not_found",
  "no_valid_fields",
  "cannot_reorder",
  "source_code_immutable",
  "booking_source_create_failed",
  "booking_source_update_failed",
]);
