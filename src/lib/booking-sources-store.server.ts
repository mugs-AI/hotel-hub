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
  usedCount: number;
};

type Row = {
  id: string;
  tenant_id: string;
  source_code: string;
  display_name: string;
  is_active: boolean;
  sort_order: number;
};

function toDto(row: Row, usedCount = 0): BookingSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceCode: row.source_code,
    displayName: row.display_name,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    usedCount,
  };
}

const CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
export const NAME_MAX = 80;

export function isSourceCodeFormat(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

/** Deterministically derive a snake_case source_code from a display name. */
export function slugifyDisplayName(name: string): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;
  let s = trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  s = s.replace(/^[0-9_]+/, "");
  if (!s) return null;
  s = s.slice(0, 45);
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
  const rows = (res.data as Row[] | null | undefined) ?? [];
  const counts = await getUsageCounts(tenantId);
  return rows.map((r) => toDto(r, counts.get(r.source_code) ?? 0));
}

async function getUsageCounts(tenantId: string): Promise<Map<string, number>> {
  const supa = await admin();
  const res = await supa
    .from("hotel_reservations")
    .select("booking_source")
    .eq("tenant_id", tenantId);
  const out = new Map<string, number>();
  if (res.error) return out;
  const rows = (res.data as Array<{ booking_source: string | null }> | null) ?? [];
  for (const row of rows) {
    const code = row.booking_source;
    if (!code) continue;
    out.set(code, (out.get(code) ?? 0) + 1);
  }
  return out;
}

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

/** Case-insensitive dedupe check for tenant-scoped display names. */
async function displayNameTakenByOther(
  tenantId: string,
  candidate: string,
  excludeId: string | null,
): Promise<boolean> {
  const supa = await admin();
  const res = await supa
    .from("hotel_booking_sources")
    .select("id, display_name")
    .eq("tenant_id", tenantId);
  if (res.error) return false;
  const rows = (res.data ?? []) as Array<{ id: string; display_name: string }>;
  const needle = candidate.trim().toLowerCase();
  return rows.some((r) => r.id !== excludeId && r.display_name.trim().toLowerCase() === needle);
}

export async function createBookingSource(input: CreateSourceInput): Promise<BookingSource> {
  const supa = await admin();
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new BookingSourceError("invalid_source_name");
  if (displayName.length > NAME_MAX) throw new BookingSourceError("invalid_source_name");

  if (await displayNameTakenByOther(input.tenantId, displayName, null)) {
    throw new BookingSourceError("source_name_exists");
  }

  const base = slugifyDisplayName(displayName);
  if (!base) throw new BookingSourceError("invalid_source_name");

  // Deterministic collision resolution: base, base_2, base_3, ...
  // Read once and pick the smallest unused suffix among that tenant's codes.
  const existing = await supa
    .from("hotel_booking_sources")
    .select("source_code, sort_order")
    .eq("tenant_id", input.tenantId);
  if (existing.error) throw new BookingSourceError("booking_source_create_failed");
  const rows = (existing.data ?? []) as Array<{ source_code: string; sort_order: number }>;
  const codes = new Set(rows.map((r) => r.source_code));
  let code = base;
  for (let i = 2; codes.has(code); i++) code = `${base.slice(0, 45)}_${i}`;
  if (!CODE_RE.test(code)) throw new BookingSourceError("booking_source_create_failed");
  const nextOrder = rows.length > 0 ? Math.max(...rows.map((r) => Number(r.sort_order))) + 10 : 10;

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
      if (msg.includes("display_name")) throw new BookingSourceError("source_name_exists");
      // Concurrent code collision — surface as create failed; the retry
      // path is manual (user re-submits and slugify picks a new suffix).
      throw new BookingSourceError("booking_source_create_failed");
    }
    throw new BookingSourceError("booking_source_create_failed");
  }
  return toDto(inserted.data as Row);
}

export async function updateBookingSource(input: UpdateSourceInput): Promise<BookingSource> {
  const supa = await admin();
  const current = await supa
    .from("hotel_booking_sources")
    .select("id, tenant_id, source_code, display_name, is_active, sort_order")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (current.error) throw new BookingSourceError("booking_source_update_failed");
  if (!current.data) throw new BookingSourceError("booking_source_not_found");
  const row = current.data as Row;

  // Reorder = neighbour swap. Edge attempts (first-up, last-down) succeed
  // as a no-op so the UI never needs to disable the button conditionally.
  if (input.direction) {
    const asc = input.direction === "down";
    let q = supa
      .from("hotel_booking_sources")
      .select("id, sort_order")
      .eq("tenant_id", input.tenantId);
    q = asc ? q.gt("sort_order", row.sort_order) : q.lt("sort_order", row.sort_order);
    const neighbourRes = await q.order("sort_order", { ascending: asc }).limit(1);
    if (neighbourRes.error) throw new BookingSourceError("booking_source_update_failed");
    const neigh = (neighbourRes.data ?? [])[0] as { id: string; sort_order: number } | undefined;
    if (!neigh) {
      // Safe no-op at the edge.
      return toDto(row, 0);
    }
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
    if (!dn) throw new BookingSourceError("invalid_source_name");
    if (dn.length > NAME_MAX) throw new BookingSourceError("invalid_source_name");
    if (await displayNameTakenByOther(input.tenantId, dn, row.id))
      throw new BookingSourceError("source_name_exists");
    patch.display_name = dn;
  }
  if (input.isActive !== undefined) {
    if (input.isActive === false && row.is_active === true) {
      // Never allow deactivation of the LAST active source.
      const active = await supa
        .from("hotel_booking_sources")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("is_active", true);
      if (active.error) throw new BookingSourceError("booking_source_update_failed");
      const activeRows = (active.data ?? []) as Array<{ id: string }>;
      const otherActive = activeRows.filter((r) => r.id !== row.id).length;
      if (otherActive === 0) throw new BookingSourceError("last_active_booking_source");
    }
    patch.is_active = input.isActive === true;
  }
  if (Object.keys(patch).length === 0) throw new BookingSourceError("invalid_source_update");

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
      throw new BookingSourceError("source_name_exists");
    throw new BookingSourceError("booking_source_update_failed");
  }
  return toDto(updated.data as Row);
}

export const BOOKING_SOURCE_ERROR_CODES = new Set<string>([
  "invalid_source_name",
  "source_name_exists",
  "booking_source_not_found",
  "last_active_booking_source",
  "invalid_source_update",
  "booking_source_create_failed",
  "booking_source_update_failed",
  // Legacy aliases kept for older callers still in the tree:
  "display_name_required",
  "display_name_too_long",
  "duplicate_source_code",
  "duplicate_display_name",
  "duplicate_source",
  "not_found",
  "no_valid_fields",
  "cannot_reorder",
  "source_code_immutable",
  "invalid_source_code",
]);
