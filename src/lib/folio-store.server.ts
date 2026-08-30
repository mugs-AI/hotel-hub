// HH-GOLIVE-01A — server-only, tenant-isolated persistence and orchestration
// for the authoritative folio, the Owner add-on catalogue, the property
// financial settings and the reservation tax profile.
//
// HARD SCOPE BOUNDARY (enforced by review + tests):
//   * NOTHING in this module writes to N3. There is no CashMemo, no invoice,
//     no receipt, no deposit matching and no refund. Preparation only.
//   * Every function requires an explicit tenantId supplied by the trusted
//     server session context; request input is never trusted for tenancy.
//   * All money is integer cents server-side. Display numbers only ever
//     appear at the DTO boundary.
import { centsToAmount, parseCents, type RoundingMode } from "./folio-money";
import {
  canReverseLine,
  computeFolio,
  isEffectiveLine,
  isGuestTaxClass,
  planMissingRoomNights,
  type FolioLineStatus,
  type FolioLineType,
  type GuestTaxClass,
  type RoomNightPlanRoom,
  type StoredFolioLine,
} from "./folio";
import {
  isTaxClass,
  isUsableAddon,
  mappingStatus,
  validateAddonInput,
  type AddonInput,
  type AddonItem,
  type TaxClass,
} from "./charges-catalogue";
import {
  applySettingsPatch,
  defaultFinancialSettings,
  settingsWindowError,
  validateSettingsPatch,
  type FinancialSettings,
} from "./financial-settings";
import { folioReadinessProjection } from "./folio-readiness";
import { decideClaim, operationFingerprint, type FolioOperation } from "./folio-operations";
import { propertyTodayIso } from "./checkout-preview";
import type {
  FolioCatalogueOptionDTO,
  FolioDerivedLineDTO,
  FolioLineDTO,
  FolioViewDTO,
  TourismTaxEvidenceDTO,
} from "./folio-view";

// ------------------------------------------------------------------ db shim

type DbError = { message: string; code?: string } | null;
type ListRes<T> = { data: T[] | null; error: DbError };
type OneRes<T> = { data: T | null; error: DbError };

export interface FolioQuery<T> extends PromiseLike<ListRes<T>> {
  select(cols?: string): FolioQuery<T>;
  eq(col: string, value: unknown): FolioQuery<T>;
  in(col: string, values: readonly unknown[]): FolioQuery<T>;
  order(col: string, opts?: { ascending?: boolean }): FolioQuery<T>;
  limit(n: number): FolioQuery<T>;
  insert(values: unknown): FolioQuery<T>;
  update(values: unknown): FolioQuery<T>;
  maybeSingle(): PromiseLike<OneRes<T>>;
  single(): PromiseLike<OneRes<T>>;
}

export interface FolioDb {
  from<T>(table: string): FolioQuery<T>;
  /** Required for the atomic reversal transaction. */
  rpc?(fn: string, args: Record<string, unknown>): PromiseLike<OneRes<unknown>>;
}

async function liveDb(): Promise<FolioDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as FolioDb;
}

async function resolveDb(sb?: FolioDb): Promise<FolioDb> {
  return sb ?? (await liveDb());
}

export class FolioError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "FolioError";
  }
}

export function folioErrorStatus(code: string): number {
  if (
    code === "reservation_not_found" ||
    code === "line_not_found" ||
    code === "item_not_found" ||
    code === "folio_not_found"
  ) {
    return 404;
  }
  if (
    code === "display_name_exists" ||
    code === "already_reversed" ||
    code === "idempotency_conflict" ||
    code === "line_not_reversible" ||
    code === "room_night_not_reversible"
  ) {
    return 409;
  }
  if (code === "reversal_not_atomic") return 500;
  if (code.endsWith("_failed")) return 500;
  return 400;
}

function fail(res: { error: DbError }, code: string): void {
  if (res.error) throw new FolioError(code, 500);
}

function isDuplicate(error: DbError): boolean {
  const msg = String(error?.message ?? "").toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique") || error?.code === "23505";
}

// ------------------------------------------------------------- catalogue

type CatalogueRow = {
  id: string;
  category: string;
  tax_class: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  default_unit_price_cents: number;
  n3_stock_id: string | null;
  n3_uom_id: string | null;
  n3_tax_code_id: string | null;
  n3_stock_code_snapshot: string | null;
  n3_stock_name_snapshot: string | null;
  n3_uom_snapshot: string | null;
  n3_tax_code_snapshot: string | null;
  sort_order: number;
};

const CATALOGUE_COLS =
  "id, category, tax_class, display_name, description, is_active, default_unit_price_cents, n3_stock_id, n3_uom_id, n3_tax_code_id, n3_stock_code_snapshot, n3_stock_name_snapshot, n3_uom_snapshot, n3_tax_code_snapshot, sort_order";

function toAddonItem(row: CatalogueRow): AddonItem {
  return {
    id: row.id,
    category: row.category as AddonItem["category"],
    taxClass: row.tax_class as TaxClass,
    displayName: row.display_name,
    description: row.description,
    isActive: row.is_active,
    defaultUnitPriceCents: Number(row.default_unit_price_cents),
    n3StockId: row.n3_stock_id,
    n3UomId: row.n3_uom_id,
    n3TaxCodeId: row.n3_tax_code_id,
    n3StockCodeSnapshot: row.n3_stock_code_snapshot,
    n3StockNameSnapshot: row.n3_stock_name_snapshot,
    n3UomSnapshot: row.n3_uom_snapshot,
    n3TaxCodeSnapshot: row.n3_tax_code_snapshot,
    sortOrder: Number(row.sort_order),
  };
}

function addonRowPatch(value: Omit<AddonItem, "id">): Record<string, unknown> {
  return {
    category: value.category,
    tax_class: value.taxClass,
    display_name: value.displayName,
    description: value.description,
    is_active: value.isActive,
    default_unit_price_cents: value.defaultUnitPriceCents,
    n3_stock_id: value.n3StockId,
    n3_uom_id: value.n3UomId,
    n3_tax_code_id: value.n3TaxCodeId,
    n3_stock_code_snapshot: value.n3StockCodeSnapshot,
    n3_stock_name_snapshot: value.n3StockNameSnapshot,
    n3_uom_snapshot: value.n3UomSnapshot,
    n3_tax_code_snapshot: value.n3TaxCodeSnapshot,
    sort_order: value.sortOrder,
  };
}

export async function listAddonItems(
  tenantId: string,
  opts: { activeOnly?: boolean; usableOnly?: boolean } = {},
  sb?: FolioDb,
): Promise<AddonItem[]> {
  const db = await resolveDb(sb);
  const res = await db
    .from<CatalogueRow>("hotel_addon_catalogue")
    .select(CATALOGUE_COLS)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });
  fail(res, "catalogue_read_failed");
  let items = (res.data ?? []).map(toAddonItem);
  if (opts.activeOnly) items = items.filter((i) => i.isActive);
  if (opts.usableOnly) items = items.filter(isUsableAddon);
  return items;
}

export async function getAddonItem(
  tenantId: string,
  id: string,
  sb?: FolioDb,
): Promise<AddonItem | null> {
  const db = await resolveDb(sb);
  const res = await db
    .from<CatalogueRow>("hotel_addon_catalogue")
    .select(CATALOGUE_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw new FolioError("catalogue_read_failed", 500);
  return res.data ? toAddonItem(res.data) : null;
}

export async function createAddonItem(
  tenantId: string,
  input: AddonInput,
  sb?: FolioDb,
): Promise<AddonItem> {
  const validated = validateAddonInput(input);
  if (!validated.ok) throw new FolioError(validated.code, 400);
  const db = await resolveDb(sb);
  const existing = await listAddonItems(tenantId, {}, db);
  const needle = validated.value.displayName.trim().toLowerCase();
  if (existing.some((i) => i.displayName.trim().toLowerCase() === needle)) {
    throw new FolioError("display_name_exists", 409);
  }
  const sortOrder =
    validated.value.sortOrder ||
    (existing.length ? Math.max(...existing.map((i) => i.sortOrder)) + 10 : 10);

  const res = await db
    .from<CatalogueRow>("hotel_addon_catalogue")
    .insert({ tenant_id: tenantId, ...addonRowPatch({ ...validated.value, sortOrder }) })
    .select(CATALOGUE_COLS)
    .single();
  if (res.error) {
    throw new FolioError(
      isDuplicate(res.error) ? "display_name_exists" : "catalogue_write_failed",
      isDuplicate(res.error) ? 409 : 500,
    );
  }
  if (!res.data) throw new FolioError("catalogue_write_failed", 500);
  return toAddonItem(res.data);
}

export async function updateAddonItem(
  tenantId: string,
  id: string,
  input: AddonInput,
  sb?: FolioDb,
): Promise<AddonItem> {
  const db = await resolveDb(sb);
  const current = await getAddonItem(tenantId, id, db);
  if (!current) throw new FolioError("item_not_found", 404);

  // Merge so a partial edit never silently clears an existing mapping.
  const merged: AddonInput = {
    category: input.category ?? current.category,
    taxClass: input.taxClass ?? current.taxClass,
    displayName: input.displayName ?? current.displayName,
    description: input.description === undefined ? current.description : input.description,
    isActive: input.isActive === undefined ? current.isActive : input.isActive,
    defaultUnitPriceCents:
      input.defaultUnitPriceCents === undefined
        ? current.defaultUnitPriceCents
        : input.defaultUnitPriceCents,
    n3StockId: input.n3StockId === undefined ? current.n3StockId : input.n3StockId,
    n3UomId: input.n3UomId === undefined ? current.n3UomId : input.n3UomId,
    n3TaxCodeId: input.n3TaxCodeId === undefined ? current.n3TaxCodeId : input.n3TaxCodeId,
    n3StockCodeSnapshot:
      input.n3StockCodeSnapshot === undefined
        ? current.n3StockCodeSnapshot
        : input.n3StockCodeSnapshot,
    n3StockNameSnapshot:
      input.n3StockNameSnapshot === undefined
        ? current.n3StockNameSnapshot
        : input.n3StockNameSnapshot,
    n3UomSnapshot: input.n3UomSnapshot === undefined ? current.n3UomSnapshot : input.n3UomSnapshot,
    n3TaxCodeSnapshot:
      input.n3TaxCodeSnapshot === undefined ? current.n3TaxCodeSnapshot : input.n3TaxCodeSnapshot,
    sortOrder: input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
  };
  const validated = validateAddonInput(merged);
  if (!validated.ok) throw new FolioError(validated.code, 400);

  const others = (await listAddonItems(tenantId, {}, db)).filter((i) => i.id !== id);
  const needle = validated.value.displayName.trim().toLowerCase();
  if (others.some((i) => i.displayName.trim().toLowerCase() === needle)) {
    throw new FolioError("display_name_exists", 409);
  }

  const res = await db
    .from<CatalogueRow>("hotel_addon_catalogue")
    .update({ ...addonRowPatch(validated.value), updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(CATALOGUE_COLS)
    .single();
  if (res.error || !res.data) {
    throw new FolioError(
      isDuplicate(res.error) ? "display_name_exists" : "catalogue_write_failed",
      isDuplicate(res.error) ? 409 : 500,
    );
  }
  return toAddonItem(res.data);
}

// ------------------------------------------------------- financial settings

type SettingsRow = {
  tenant_id: string;
  service_tax_registered: boolean;
  service_tax_accommodation_rate_bp: number | null;
  service_tax_fnb_rate_bp: number | null;
  service_tax_parking_rate_bp: number | null;
  service_tax_other_rate_bp: number | null;
  n3_tax_code_accommodation_id: string | null;
  n3_tax_code_accommodation_snapshot: string | null;
  n3_tax_code_fnb_id: string | null;
  n3_tax_code_fnb_snapshot: string | null;
  n3_tax_code_parking_id: string | null;
  n3_tax_code_parking_snapshot: string | null;
  n3_tax_code_other_id: string | null;
  n3_tax_code_other_snapshot: string | null;
  n3_tax_code_exempt_id: string | null;
  n3_tax_code_exempt_snapshot: string | null;
  service_charge_enabled: boolean;
  service_charge_percent_bp: number;
  service_charge_service_tax_applies: boolean;
  tourism_tax_enabled: boolean;
  tourism_tax_cents_per_room_night: number;
  tourism_tax_effective_from: string | null;
  tourism_tax_effective_to: string | null;
  local_levy_enabled: boolean;
  local_levy_label: string | null;
  local_levy_cents_per_room_night: number;
  local_levy_effective_from: string | null;
  local_levy_effective_to: string | null;
  rounding_mode: string;
  n3_rounding_account_id: string | null;
  n3_rounding_account_snapshot: string | null;
  /**
   * HH-GOLIVE-01A UAT correction. Supplied by the STAGED migration under
   * db/migrations-pending, which is intentionally NOT applied in this
   * milestone. Until it is, the column is absent and this stays undefined —
   * the model then falls back to unmapped defaults and readiness stays
   * blocked, which is the correct fail-closed behaviour.
   */
  posting_mappings?: unknown;
  updated_at: string | null;
};

const SETTINGS_COLS = "*";

function toSettings(tenantId: string, row: SettingsRow | null): FinancialSettings {
  if (!row) return defaultFinancialSettings(tenantId);
  return {
    tenantId,
    serviceTaxRegistered: Boolean(row.service_tax_registered),
    serviceTax: {
      accommodation: {
        rateBp: row.service_tax_accommodation_rate_bp,
        n3TaxCodeId: row.n3_tax_code_accommodation_id,
        n3TaxCodeSnapshot: row.n3_tax_code_accommodation_snapshot,
      },
      food_and_beverage: {
        rateBp: row.service_tax_fnb_rate_bp,
        n3TaxCodeId: row.n3_tax_code_fnb_id,
        n3TaxCodeSnapshot: row.n3_tax_code_fnb_snapshot,
      },
      parking: {
        rateBp: row.service_tax_parking_rate_bp,
        n3TaxCodeId: row.n3_tax_code_parking_id,
        n3TaxCodeSnapshot: row.n3_tax_code_parking_snapshot,
      },
      other_taxable_service: {
        rateBp: row.service_tax_other_rate_bp,
        n3TaxCodeId: row.n3_tax_code_other_id,
        n3TaxCodeSnapshot: row.n3_tax_code_other_snapshot,
      },
    },
    exempt: {
      n3TaxCodeId: row.n3_tax_code_exempt_id,
      n3TaxCodeSnapshot: row.n3_tax_code_exempt_snapshot,
    },
    serviceCharge: {
      enabled: Boolean(row.service_charge_enabled),
      percentBp: Number(row.service_charge_percent_bp ?? 0),
      serviceTaxApplies: Boolean(row.service_charge_service_tax_applies),
    },
    tourismTax: {
      enabled: Boolean(row.tourism_tax_enabled),
      centsPerRoomNight: Number(row.tourism_tax_cents_per_room_night ?? 0),
      effectiveFrom: row.tourism_tax_effective_from,
      effectiveTo: row.tourism_tax_effective_to,
    },
    localLevy: {
      enabled: Boolean(row.local_levy_enabled),
      label: row.local_levy_label,
      centsPerRoomNight: Number(row.local_levy_cents_per_room_night ?? 0),
      effectiveFrom: row.local_levy_effective_from,
      effectiveTo: row.local_levy_effective_to,
    },
    rounding: {
      mode: (row.rounding_mode ?? "none") as RoundingMode,
      n3RoundingAccountId: row.n3_rounding_account_id,
      n3RoundingAccountSnapshot: row.n3_rounding_account_snapshot,
    },
    postingMappings: parsePostingMappings(row.posting_mappings),
    updatedAt: row.updated_at,
  };
}

function settingsToRow(s: FinancialSettings): Record<string, unknown> {
  return {
    service_tax_registered: s.serviceTaxRegistered,
    service_tax_accommodation_rate_bp: s.serviceTax.accommodation.rateBp,
    service_tax_fnb_rate_bp: s.serviceTax.food_and_beverage.rateBp,
    service_tax_parking_rate_bp: s.serviceTax.parking.rateBp,
    service_tax_other_rate_bp: s.serviceTax.other_taxable_service.rateBp,
    n3_tax_code_accommodation_id: s.serviceTax.accommodation.n3TaxCodeId,
    n3_tax_code_accommodation_snapshot: s.serviceTax.accommodation.n3TaxCodeSnapshot,
    n3_tax_code_fnb_id: s.serviceTax.food_and_beverage.n3TaxCodeId,
    n3_tax_code_fnb_snapshot: s.serviceTax.food_and_beverage.n3TaxCodeSnapshot,
    n3_tax_code_parking_id: s.serviceTax.parking.n3TaxCodeId,
    n3_tax_code_parking_snapshot: s.serviceTax.parking.n3TaxCodeSnapshot,
    n3_tax_code_other_id: s.serviceTax.other_taxable_service.n3TaxCodeId,
    n3_tax_code_other_snapshot: s.serviceTax.other_taxable_service.n3TaxCodeSnapshot,
    n3_tax_code_exempt_id: s.exempt.n3TaxCodeId,
    n3_tax_code_exempt_snapshot: s.exempt.n3TaxCodeSnapshot,
    service_charge_enabled: s.serviceCharge.enabled,
    service_charge_percent_bp: s.serviceCharge.percentBp,
    service_charge_service_tax_applies: s.serviceCharge.serviceTaxApplies,
    tourism_tax_enabled: s.tourismTax.enabled,
    tourism_tax_cents_per_room_night: s.tourismTax.centsPerRoomNight,
    tourism_tax_effective_from: s.tourismTax.effectiveFrom,
    tourism_tax_effective_to: s.tourismTax.effectiveTo,
    local_levy_enabled: s.localLevy.enabled,
    local_levy_label: s.localLevy.label,
    local_levy_cents_per_room_night: s.localLevy.centsPerRoomNight,
    local_levy_effective_from: s.localLevy.effectiveFrom,
    local_levy_effective_to: s.localLevy.effectiveTo,
    rounding_mode: s.rounding.mode,
    n3_rounding_account_id: s.rounding.n3RoundingAccountId,
    n3_rounding_account_snapshot: s.rounding.n3RoundingAccountSnapshot,
    posting_mappings: s.postingMappings,
  };
}

/** True when the write failed only because the staged column is not applied. */
function isMissingPostingMappingsColumn(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("posting_mappings");
}

export async function readFinancialSettings(
  tenantId: string,
  sb?: FolioDb,
): Promise<FinancialSettings> {
  const db = await resolveDb(sb);
  const res = await db
    .from<SettingsRow>("hotel_financial_settings")
    .select(SETTINGS_COLS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (res.error) throw new FolioError("financial_settings_read_failed", 500);
  return toSettings(tenantId, res.data ?? null);
}

export async function patchFinancialSettings(
  tenantId: string,
  rawPatch: unknown,
  actorKey: string,
  sb?: FolioDb,
): Promise<FinancialSettings> {
  const validated = validateSettingsPatch(rawPatch);
  if (!validated.ok) throw new FolioError(validated.code, 400);
  const db = await resolveDb(sb);
  const current = await readFinancialSettings(tenantId, db);
  const next = applySettingsPatch(current, validated.patch);
  // Effective windows are re-checked against the MERGED state so a patch that
  // touches only one bound cannot create an inverted window.
  const windowError = settingsWindowError(next);
  if (windowError) throw new FolioError(windowError, 400);
  const row = {
    ...settingsToRow(next),
    updated_by_n3_user_key: actorKey,
    updated_at: new Date().toISOString(),
  };

  async function write(payload: Record<string, unknown>) {
    const updated = await db
      .from<SettingsRow>("hotel_financial_settings")
      .update(payload)
      .eq("tenant_id", tenantId)
      .select(SETTINGS_COLS)
      .maybeSingle();
    if (updated.error) return { error: updated.error, data: null };
    if (updated.data) return { error: null, data: updated.data };
    const inserted = await db
      .from<SettingsRow>("hotel_financial_settings")
      .insert({ tenant_id: tenantId, ...payload })
      .select(SETTINGS_COLS)
      .single();
    return { error: inserted.error ?? (inserted.data ? null : new Error("no_row")), data: inserted.data };
  }

  let result = await write(row);
  if (result.error && isMissingPostingMappingsColumn(result.error)) {
    // The staged migration has not been applied yet. Persist everything else
    // rather than failing the Owner's save; the mappings simply stay unstored,
    // so readiness remains blocked.
    const { posting_mappings: _omitted, ...withoutMappings } = row;
    void _omitted;
    result = await write(withoutMappings);
  }
  if (result.error || !result.data) throw new FolioError("financial_settings_write_failed", 500);
  return toSettings(tenantId, result.data);
}

// ------------------------------------------------------------- tax profile

type TaxProfileRow = {
  guest_tax_class: string;
  evidence_note: string | null;
  updated_at: string | null;
};

export type TaxProfile = {
  guestTaxClass: GuestTaxClass;
  evidenceNote: string | null;
  updatedAt: string | null;
};

export async function readTaxProfile(
  tenantId: string,
  reservationId: string,
  sb?: FolioDb,
): Promise<TaxProfile> {
  const db = await resolveDb(sb);
  const res = await db
    .from<TaxProfileRow>("hotel_reservation_tax_profile")
    .select("guest_tax_class, evidence_note, updated_at")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (res.error) throw new FolioError("tax_profile_read_failed", 500);
  const row = res.data;
  return {
    guestTaxClass: isGuestTaxClass(row?.guest_tax_class) ? row!.guest_tax_class : "unknown",
    evidenceNote: row?.evidence_note ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function setGuestTaxClass(
  input: {
    tenantId: string;
    reservationId: string;
    guestTaxClass: unknown;
    evidenceNote?: unknown;
    actorKey: string;
  },
  sb?: FolioDb,
): Promise<TaxProfile> {
  if (!isGuestTaxClass(input.guestTaxClass)) throw new FolioError("invalid_guest_tax_class", 400);
  let note: string | null = null;
  if (input.evidenceNote !== undefined && input.evidenceNote !== null) {
    if (typeof input.evidenceNote !== "string") throw new FolioError("invalid_evidence_note", 400);
    const t = input.evidenceNote.trim();
    if (t.length > 240) throw new FolioError("invalid_evidence_note", 400);
    note = t || null;
  }
  const db = await resolveDb(sb);
  const row = {
    guest_tax_class: input.guestTaxClass,
    evidence_note: note,
    updated_by_n3_user_key: input.actorKey,
    updated_at: new Date().toISOString(),
  };
  const updated = await db
    .from<TaxProfileRow>("hotel_reservation_tax_profile")
    .update(row)
    .eq("tenant_id", input.tenantId)
    .eq("reservation_id", input.reservationId)
    .select("guest_tax_class, evidence_note, updated_at")
    .maybeSingle();
  if (updated.error) throw new FolioError("tax_profile_write_failed", 500);
  if (!updated.data) {
    const inserted = await db
      .from<TaxProfileRow>("hotel_reservation_tax_profile")
      .insert({ tenant_id: input.tenantId, reservation_id: input.reservationId, ...row })
      .select("guest_tax_class, evidence_note, updated_at")
      .single();
    if (inserted.error) throw new FolioError("tax_profile_write_failed", 500);
  }
  return {
    guestTaxClass: input.guestTaxClass,
    evidenceNote: note,
    updatedAt: row.updated_at,
  };
}

type EvidenceRow = {
  id: string;
  source_label: string;
  reference: string | null;
  collected_on: string | null;
  amount_cents: number;
  note: string | null;
  created_at: string;
  client_request_id: string | null;
};

const EVIDENCE_COLS =
  "id, source_label, reference, collected_on, amount_cents, note, created_at, client_request_id";

export async function listTourismTaxEvidence(
  tenantId: string,
  reservationId: string,
  sb?: FolioDb,
): Promise<{ rows: EvidenceRow[]; totalCents: number }> {
  const db = await resolveDb(sb);
  const res = await db
    .from<EvidenceRow>("hotel_tourism_tax_evidence")
    .select(EVIDENCE_COLS)
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: true });
  if (res.error) throw new FolioError("tourism_tax_evidence_read_failed", 500);
  const rows = res.data ?? [];
  return {
    rows,
    totalCents: rows.reduce((acc, r) => acc + Number(r.amount_cents ?? 0), 0),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function addTourismTaxEvidence(
  input: {
    tenantId: string;
    reservationId: string;
    sourceLabel: unknown;
    reference?: unknown;
    collectedOn?: unknown;
    amountCents: unknown;
    note?: unknown;
    clientRequestId: unknown;
    actorKey: string;
  },
  sb?: FolioDb,
): Promise<EvidenceRow> {
  if (typeof input.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) {
    throw new FolioError("invalid_client_request_id", 400);
  }
  const label = typeof input.sourceLabel === "string" ? input.sourceLabel.trim() : "";
  if (label.length < 2 || label.length > 60) throw new FolioError("invalid_source_label", 400);
  const amount = input.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > 1e8) {
    throw new FolioError("invalid_amount", 400);
  }
  const reference =
    input.reference === undefined || input.reference === null
      ? null
      : typeof input.reference === "string" && input.reference.trim().length <= 80
        ? input.reference.trim() || null
        : undefined;
  if (reference === undefined) throw new FolioError("invalid_reference", 400);
  const note =
    input.note === undefined || input.note === null
      ? null
      : typeof input.note === "string" && input.note.trim().length <= 240
        ? input.note.trim() || null
        : undefined;
  if (note === undefined) throw new FolioError("invalid_note", 400);
  const collectedOn =
    input.collectedOn === undefined || input.collectedOn === null
      ? null
      : typeof input.collectedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.collectedOn)
        ? input.collectedOn
        : undefined;
  if (collectedOn === undefined) throw new FolioError("invalid_collected_on", 400);

  const db = await resolveDb(sb);
  if (typeof db.rpc !== "function") throw new FolioError("folio_write_not_atomic", 500);

  // ONE transaction: operation claim + insert. A replayed request can never
  // double-credit the guest, and a different body under the same request id
  // is refused instead of silently accepted.
  const fingerprint = await operationFingerprint(
    "folio.tourism_tax_evidence",
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: null,
      lineId: null,
    },
    { label, reference, collectedOn, amountCents: amount, note },
  );
  const res = await db.rpc("hotelhub_add_tourism_tax_evidence", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_source_label: label,
    p_reference: reference,
    p_collected_on: collectedOn,
    p_amount_cents: amount,
    p_note: note,
    p_client_request_id: input.clientRequestId,
    p_actor_n3_user_key: input.actorKey,
    p_request_fingerprint: fingerprint,
  });
  if (res.error) throw new FolioError("tourism_tax_evidence_write_failed", 500);
  const payload = res.data as { ok?: boolean; code?: string; evidenceId?: string | null } | null;
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    const code =
      typeof payload?.code === "string" ? payload.code : "tourism_tax_evidence_write_failed";
    throw new FolioError(code, folioErrorStatus(code));
  }

  const stored = await db
    .from<EvidenceRow>("hotel_tourism_tax_evidence")
    .select(EVIDENCE_COLS)
    .eq("tenant_id", input.tenantId)
    .eq("reservation_id", input.reservationId)
    .eq("client_request_id", input.clientRequestId)
    .maybeSingle();
  if (stored.error || !stored.data) throw new FolioError("tourism_tax_evidence_read_failed", 500);
  return stored.data;
}

// ------------------------------------------------------------------ folio

type FolioRow = { id: string; currency: string; status: string };

type LineRow = {
  id: string;
  line_type: string;
  status: string;
  tax_class: string | null;
  description_snapshot: string;
  quantity: number;
  version?: number | null;
  unit_price_cents: number;
  subtotal_cents: number;
  source_reservation_room_id: string | null;
  source_hotel_room_id: string | null;
  stay_date: string | null;
  catalogue_id: string | null;
  reason: string | null;
  reverses_line_id: string | null;
  actor_n3_user_key: string;
  client_request_id: string | null;
  created_at: string;
};

const LINE_COLS =
  "id, line_type, status, tax_class, description_snapshot, quantity, version, unit_price_cents, subtotal_cents, source_reservation_room_id, source_hotel_room_id, stay_date, catalogue_id, reason, reverses_line_id, actor_n3_user_key, client_request_id, created_at";

export async function ensureFolio(
  tenantId: string,
  reservationId: string,
  currency: string,
  sb?: FolioDb,
): Promise<FolioRow> {
  const db = await resolveDb(sb);
  const found = await db
    .from<FolioRow>("hotel_folios")
    .select("id, currency, status")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (found.error) throw new FolioError("folio_read_failed", 500);
  if (found.data) return found.data;

  const inserted = await db
    .from<FolioRow>("hotel_folios")
    .insert({ tenant_id: tenantId, reservation_id: reservationId, currency })
    .select("id, currency, status")
    .single();
  if (inserted.error || !inserted.data) {
    // Concurrent create — re-read is the authoritative answer.
    const replay = await db
      .from<FolioRow>("hotel_folios")
      .select("id, currency, status")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .maybeSingle();
    if (replay.data) return replay.data;
    throw new FolioError("folio_write_failed", 500);
  }
  return inserted.data;
}

/**
 * The authoritative folio for THIS reservation — read only, never created.
 * Every line mutation proves its scope against the id returned here, so a
 * line belonging to another reservation of the same tenant can never be
 * reached through this reservation's route.
 */
export async function readFolioForReservation(
  tenantId: string,
  reservationId: string,
  db: FolioDb,
): Promise<FolioRow | null> {
  const res = await db
    .from<FolioRow>("hotel_folios")
    .select("id, currency, status")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (res.error) throw new FolioError("folio_read_failed", 500);
  return res.data ?? null;
}

// ------------------------------------------ operation-scoped idempotency

type OperationRow = {
  id: string;
  operation: string;
  folio_id: string | null;
  target_line_id: string | null;
  request_fingerprint: string;
  result_line_id: string | null;
};

const OPERATION_COLS =
  "id, operation, folio_id, target_line_id, request_fingerprint, result_line_id";

/**
 * Claim an operation key. Returns the replayed line id when the SAME
 * operation, target and payload is retried; throws `idempotency_conflict`
 * when the same client request id is reused for anything else.
 */
async function claimFolioOperation(
  db: FolioDb,
  input: {
    tenantId: string;
    operation: FolioOperation;
    reservationId: string;
    folioId: string | null;
    lineId: string | null;
    clientRequestId: string;
    fingerprint: string;
    actorKey: string;
  },
): Promise<{ replayLineId: string | null } | null> {
  const existing = await db
    .from<OperationRow>("hotel_folio_operations")
    .select(OPERATION_COLS)
    .eq("tenant_id", input.tenantId)
    .eq("operation", input.operation)
    .eq("client_request_id", input.clientRequestId)
    .maybeSingle();
  if (existing.error) throw new FolioError("folio_read_failed", 500);

  const decision = decideClaim(
    existing.data
      ? {
          operation: existing.data.operation,
          folioId: existing.data.folio_id,
          targetLineId: existing.data.target_line_id,
          requestFingerprint: existing.data.request_fingerprint,
          resultLineId: existing.data.result_line_id,
        }
      : null,
    {
      operation: input.operation,
      folioId: input.folioId,
      lineId: input.lineId,
      fingerprint: input.fingerprint,
    },
  );
  if (decision.kind === "conflict") throw new FolioError("idempotency_conflict", 409);
  if (decision.kind === "replay") return { replayLineId: decision.resultLineId };
  return null;
}

async function recordFolioOperation(
  db: FolioDb,
  input: {
    tenantId: string;
    operation: FolioOperation;
    reservationId: string;
    folioId: string | null;
    lineId: string | null;
    clientRequestId: string;
    fingerprint: string;
    resultLineId: string | null;
    actorKey: string;
  },
): Promise<void> {
  const res = await db.from<OperationRow>("hotel_folio_operations").insert({
    tenant_id: input.tenantId,
    operation: input.operation,
    reservation_id: input.reservationId,
    folio_id: input.folioId,
    target_line_id: input.lineId,
    client_request_id: input.clientRequestId,
    request_fingerprint: input.fingerprint,
    result_line_id: input.resultLineId,
    actor_n3_user_key: input.actorKey,
  });
  // A concurrent identical claim is not an error: the unique index is the
  // authority and the stored result is the same line.
  if (res.error && !isDuplicate(res.error)) throw new FolioError("folio_write_failed", 500);
}

/** Read one line, proving tenant + folio + line in a single query. */
async function readScopedLine(
  db: FolioDb,
  tenantId: string,
  folioId: string,
  lineId: string,
): Promise<LineRow | null> {
  const res = await db
    .from<LineRow>("hotel_folio_lines")
    .select(LINE_COLS)
    .eq("tenant_id", tenantId)
    .eq("folio_id", folioId)
    .eq("id", lineId)
    .maybeSingle();
  if (res.error) throw new FolioError("folio_read_failed", 500);
  return res.data ?? null;
}

function toStoredLine(row: LineRow, actorLabels: Map<string, string>): StoredFolioLine {
  return {
    id: row.id,
    lineType: row.line_type as FolioLineType,
    status: row.status as FolioLineStatus,
    taxClass: (row.tax_class as TaxClass | null) ?? null,
    description: row.description_snapshot,
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents),
    subtotalCents: Number(row.subtotal_cents),
    reversesLineId: row.reverses_line_id,
    reason: row.reason,
    stayDate: row.stay_date,
    reservationRoomId: row.source_reservation_room_id,
    roomLabel: null,
    actorLabel: actorLabels.get(row.actor_n3_user_key) ?? null,
    createdAt: row.created_at,
  };
}

async function readActorLabels(
  tenantId: string,
  keys: readonly string[],
  db: FolioDb,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return out;
  const res = await db
    .from<{
      n3_user_key: string;
      display_name: string | null;
      email: string | null;
    }>("hotel_user_directory")
    .select("n3_user_key, display_name, email")
    .eq("tenant_id", tenantId)
    .in("n3_user_key", unique);
  if (res.error) return out;
  for (const r of res.data ?? []) {
    const label = r.display_name?.trim() || r.email?.trim() || null;
    if (label) out.set(r.n3_user_key, label);
  }
  return out;
}

export async function readFolioLines(
  tenantId: string,
  folioId: string,
  sb?: FolioDb,
): Promise<{ rows: LineRow[]; lines: StoredFolioLine[] }> {
  const db = await resolveDb(sb);
  const res = await db
    .from<LineRow>("hotel_folio_lines")
    .select(LINE_COLS)
    .eq("tenant_id", tenantId)
    .eq("folio_id", folioId)
    .order("created_at", { ascending: true });
  if (res.error) throw new FolioError("folio_read_failed", 500);
  const rows = res.data ?? [];
  const labels = await readActorLabels(
    tenantId,
    rows.map((r) => r.actor_n3_user_key),
    db,
  );
  return { rows, lines: rows.map((r) => toStoredLine(r, labels)) };
}

type ReservationRow = {
  id: string;
  booking_reference: string;
  arrival_date: string;
  departure_date: string;
  currency: string;
};

type ReservationRoomRow = {
  id: string;
  hotel_room_id: string;
  arrival_date: string;
  departure_date: string;
  agreed_rate: number | string;
};

type RoomRow = {
  id: string;
  room_number: string;
  display_name: string | null;
  n3_stock_id: string | null;
  n3_stock_code?: string | null;
  n3_stock_name?: string | null;
};

function roomLabelOf(room: RoomRow | undefined): string {
  if (!room) return "Room";
  const name = room.display_name?.trim();
  return name ? `${room.room_number} · ${name}` : room.room_number;
}

async function readReservation(
  tenantId: string,
  reservationId: string,
  db: FolioDb,
): Promise<ReservationRow> {
  const res = await db
    .from<ReservationRow>("hotel_reservations")
    .select("id, booking_reference, arrival_date, departure_date, currency")
    .eq("tenant_id", tenantId)
    .eq("id", reservationId)
    .maybeSingle();
  if (res.error) throw new FolioError("folio_read_failed", 500);
  if (!res.data) throw new FolioError("reservation_not_found", 404);
  return res.data;
}

async function readReservationRooms(
  tenantId: string,
  reservationId: string,
  db: FolioDb,
): Promise<{ rooms: ReservationRoomRow[]; byRoomId: Map<string, RoomRow> }> {
  const res = await db
    .from<ReservationRoomRow>("hotel_reservation_rooms")
    .select("id, hotel_room_id, arrival_date, departure_date, agreed_rate")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .order("arrival_date", { ascending: true });
  if (res.error) throw new FolioError("folio_read_failed", 500);
  const rooms = res.data ?? [];
  const byRoomId = new Map<string, RoomRow>();
  if (rooms.length) {
    const roomsRes = await db
      .from<RoomRow>("hotel_rooms")
      .select("id, room_number, display_name, n3_stock_id, n3_stock_code, n3_stock_name")
      .eq("tenant_id", tenantId)
      .in(
        "id",
        rooms.map((r) => r.hotel_room_id),
      );
    if (roomsRes.error) throw new FolioError("folio_read_failed", 500);
    for (const r of roomsRes.data ?? []) byRoomId.set(r.id, r);
  }
  return { rooms, byRoomId };
}

/**
 * Snapshot every missing room-night at the agreed rate. Existing nights are
 * NEVER rewritten: a later rate change only affects nights not yet snapshotted,
 * and corrections are made by reversal.
 */
export async function syncRoomNights(
  input: { tenantId: string; reservationId: string; folioId: string; actorKey: string },
  sb?: FolioDb,
): Promise<{ inserted: number; unmappedRoomLabels: string[] }> {
  const db = await resolveDb(sb);
  const { rooms, byRoomId } = await readReservationRooms(input.tenantId, input.reservationId, db);
  const existing = await readFolioLines(input.tenantId, input.folioId, db);
  const existingNights = existing.lines
    .filter((l) => l.lineType === "room_night")
    .map((l) => ({ reservationRoomId: l.reservationRoomId, stayDate: l.stayDate }));

  const unmappedRoomLabels: string[] = [];
  const plan: RoomNightPlanRoom[] = [];
  for (const room of rooms) {
    const hotelRoom = byRoomId.get(room.hotel_room_id);
    const label = roomLabelOf(hotelRoom);
    if (!hotelRoom?.n3_stock_id) unmappedRoomLabels.push(label);
    const rate = parseCents(room.agreed_rate);
    if (rate === null) continue; // computeFolio raises the blocker instead
    plan.push({
      reservationRoomId: room.id,
      hotelRoomId: room.hotel_room_id,
      roomLabel: label,
      arrivalDate: room.arrival_date,
      departureDate: room.departure_date,
      nightlyRateCents: rate,
    });
  }

  const missing = planMissingRoomNights(plan, existingNights);
  if (missing.length === 0) return { inserted: 0, unmappedRoomLabels };

  // IMMUTABLE SNAPSHOT. Everything the night is worth, and everything it was
  // sold as, is frozen here: the N3 stock identity, the agreed rate, the room
  // identity, the stay date and the tax/levy configuration in force (with its
  // effective dates). A later remap, rate edit or settings change can never
  // rewrite an existing night — corrections are reversal-only.
  const settings = await readFinancialSettings(input.tenantId, db);
  const frozenAt = new Date().toISOString();
  const settingsSnapshot = {
    capturedAt: frozenAt,
    serviceTaxRegistered: settings.serviceTaxRegistered,
    accommodation: settings.serviceTax.accommodation,
    serviceCharge: settings.serviceCharge,
    tourismTax: settings.tourismTax,
    localLevy: settings.localLevy,
    rounding: { mode: settings.rounding.mode },
    settingsUpdatedAt: settings.updatedAt,
  };
  const payload = missing.map((n) => {
    const hotelRoom = byRoomId.get(n.hotelRoomId);
    return {
      tenant_id: input.tenantId,
      folio_id: input.folioId,
      line_type: "room_night",
      status: "draft",
      source_reservation_room_id: n.reservationRoomId,
      source_hotel_room_id: n.hotelRoomId,
      stay_date: n.stayDate,
      tax_class: "accommodation",
      description_snapshot: `Room charge — ${n.roomLabel}`.slice(0, 160),
      quantity: 1,
      unit_price_cents: n.unitPriceCents,
      subtotal_cents: n.unitPriceCents,
      total_cents: n.unitPriceCents,
      tax_snapshot: { source: "reservation_room", stayDate: n.stayDate },
      n3_stock_id_snapshot: hotelRoom?.n3_stock_id ?? null,
      n3_stock_code_snapshot: hotelRoom?.n3_stock_code ?? null,
      n3_stock_name_snapshot: hotelRoom?.n3_stock_name ?? null,
      n3_tax_code_id_snapshot: settings.serviceTax.accommodation.n3TaxCodeId ?? null,
      agreed_rate_cents_snapshot: n.unitPriceCents,
      room_label_snapshot: n.roomLabel,
      settings_snapshot: settingsSnapshot,
      snapshot_frozen_at: frozenAt,
      actor_n3_user_key: input.actorKey,
    };
  });
  const res = await db.from<LineRow>("hotel_folio_lines").insert(payload).select(LINE_COLS);
  if (res.error && !isDuplicate(res.error)) throw new FolioError("folio_write_failed", 500);
  return { inserted: res.data?.length ?? 0, unmappedRoomLabels };
}

/**
 * Explicit, idempotent folio initialisation / refresh.
 *
 * This is the ONLY caller-visible way to create the folio and snapshot room
 * nights, so reading a folio can never mutate one. Re-running it is safe:
 * `planMissingRoomNights` only ever adds the (reservationRoom, stayDate)
 * pairs that do not exist yet, and existing snapshots are never rewritten.
 */
export async function refreshFolioRoomNights(
  input: { tenantId: string; reservationId: string; actorKey: string },
  sb?: FolioDb,
): Promise<{ folioId: string; inserted: number; unmappedRoomLabels: string[] }> {
  const db = await resolveDb(sb);
  const reservation = await readReservation(input.tenantId, input.reservationId, db);
  const folio = await ensureFolio(input.tenantId, input.reservationId, reservation.currency, db);
  const result = await syncRoomNights(
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: folio.id,
      actorKey: input.actorKey,
    },
    db,
  );
  return { folioId: folio.id, ...result };
}

/**
 * Add one catalogue add-on to the reservation's authoritative folio.
 *
 * Scope proof: tenant + route reservation + that reservation's folio.
 * Idempotency: operation- and target-specific (see `folio-operations`), so a
 * reused client request id can only ever replay the identical add-on.
 */
export async function addAddonLine(
  input: {
    tenantId: string;
    reservationId: string;
    catalogueId: unknown;
    quantity: unknown;
    unitPriceCents?: unknown;
    clientRequestId: unknown;
    actorKey: string;
    /** Owner-only: a manual unit price override needs a reason. */
    reason?: unknown;
    canOverridePrice: boolean;
  },
  sb?: FolioDb,
): Promise<StoredFolioLine> {
  if (typeof input.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) {
    throw new FolioError("invalid_client_request_id", 400);
  }
  if (typeof input.catalogueId !== "string" || !UUID_RE.test(input.catalogueId)) {
    throw new FolioError("invalid_catalogue_id", 400);
  }
  const quantity = input.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > 9999
  ) {
    throw new FolioError("invalid_quantity", 400);
  }

  const db = await resolveDb(sb);
  const reservation = await readReservation(input.tenantId, input.reservationId, db);
  const folio = await ensureFolio(input.tenantId, input.reservationId, reservation.currency, db);

  const fingerprint = await operationFingerprint(
    "folio.add_addon",
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: folio.id,
      lineId: null,
    },
    {
      catalogueId: input.catalogueId,
      quantity,
      unitPriceCents: input.unitPriceCents ?? null,
      reason: typeof input.reason === "string" ? input.reason.trim() : null,
    },
  );
  const claim = await claimFolioOperation(db, {
    tenantId: input.tenantId,
    operation: "folio.add_addon",
    reservationId: input.reservationId,
    folioId: folio.id,
    lineId: null,
    clientRequestId: input.clientRequestId,
    fingerprint,
    actorKey: input.actorKey,
  });
  if (claim) {
    const replay = claim.replayLineId
      ? await readScopedLine(db, input.tenantId, folio.id, claim.replayLineId)
      : null;
    if (replay) return toStoredLine(replay, new Map());
    throw new FolioError("idempotency_conflict", 409);
  }

  const item = await getAddonItem(input.tenantId, input.catalogueId, db);
  if (!item) throw new FolioError("item_not_found", 404);
  if (!item.isActive) throw new FolioError("item_inactive", 400);
  if (mappingStatus(item) !== "mapped") throw new FolioError("item_not_mapped", 400);

  let unitPrice = item.defaultUnitPriceCents;
  let reason: string | null = null;
  if (input.unitPriceCents !== undefined && input.unitPriceCents !== null) {
    if (!input.canOverridePrice) throw new FolioError("price_override_forbidden", 403);
    const override = input.unitPriceCents;
    if (
      typeof override !== "number" ||
      !Number.isSafeInteger(override) ||
      override < 0 ||
      override > 1e9
    ) {
      throw new FolioError("invalid_unit_price", 400);
    }
    if (override !== item.defaultUnitPriceCents) {
      const r = typeof input.reason === "string" ? input.reason.trim() : "";
      if (r.length < 3 || r.length > 240) throw new FolioError("reason_required", 400);
      reason = r;
    }
    unitPrice = override;
  }
  const subtotal = unitPrice * quantity;
  if (!Number.isSafeInteger(subtotal) || subtotal > 1e9) {
    throw new FolioError("invalid_amount", 400);
  }

  const lineId = await atomicAddLine(db, {
    tenantId: input.tenantId,
    reservationId: input.reservationId,
    operation: "folio.add_addon",
    lineType: "add_on",
    catalogueId: item.id,
    taxClass: item.taxClass,
    description: item.displayName.slice(0, 160),
    quantity,
    unitPriceCents: unitPrice,
    subtotalCents: subtotal,
    taxSnapshot: {
      source: "catalogue",
      catalogueId: item.id,
      taxClass: item.taxClass,
      n3StockId: item.n3StockId,
      n3UomId: item.n3UomId,
      n3TaxCodeId: item.n3TaxCodeId,
    },
    reason,
    clientRequestId: input.clientRequestId,
    fingerprint,
    actorKey: input.actorKey,
  });
  const row = await readScopedLine(db, input.tenantId, folio.id, lineId);
  if (!row) throw new FolioError("folio_read_failed", 500);
  return toStoredLine(row, new Map());
}

/**
 * ONE transaction: operation claim + scope proof + line insert. Two
 * concurrent identical requests cannot both insert — the loser serialises on
 * the folio row lock and comes back as a replay of the same line.
 */
async function atomicAddLine(
  db: FolioDb,
  input: {
    tenantId: string;
    reservationId: string;
    operation: "folio.add_addon" | "folio.adjustment";
    lineType: "add_on" | "discount" | "manual_adjustment";
    catalogueId: string | null;
    taxClass: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    taxSnapshot: Record<string, unknown>;
    reason: string | null;
    clientRequestId: string;
    fingerprint: string;
    actorKey: string;
  },
): Promise<string> {
  if (typeof db.rpc !== "function") {
    // Fail closed: a non-transactional fallback is exactly the defect this
    // correction removes.
    throw new FolioError("folio_write_not_atomic", 500);
  }
  const res = await db.rpc("hotelhub_add_folio_line", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_operation: input.operation,
    p_line_type: input.lineType,
    p_catalogue_id: input.catalogueId,
    p_tax_class: input.taxClass,
    p_description: input.description,
    p_quantity: input.quantity,
    p_unit_price_cents: input.unitPriceCents,
    p_subtotal_cents: input.subtotalCents,
    p_tax_cents: 0,
    p_total_cents: input.subtotalCents,
    p_tax_snapshot: input.taxSnapshot,
    p_reason: input.reason,
    p_client_request_id: input.clientRequestId,
    p_actor_n3_user_key: input.actorKey,
    p_request_fingerprint: input.fingerprint,
  });
  return unwrapLineResult(res);
}

/** Shared decoding of the `{ ok, code, lineId }` envelope returned by the
 *  transactional folio functions. */
function unwrapLineResult(res: { data?: unknown; error?: DbError }): string {
  if (res.error) throw new FolioError("folio_write_failed", 500);
  const payload = res.data as { ok?: boolean; code?: string; lineId?: string | null } | null;
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    const code = typeof payload?.code === "string" ? payload.code : "folio_write_failed";
    throw new FolioError(code, folioErrorStatus(code));
  }
  if (typeof payload.lineId !== "string") throw new FolioError("folio_write_failed", 500);
  return payload.lineId;
}

/**
 * Quantity edit of a draft add-on. Atomic and operation/target/body specific:
 * the claim, the version check and the update all happen inside
 * `hotelhub_update_folio_line_quantity`, under the folio row lock.
 */
export async function updateAddonQuantity(
  input: {
    tenantId: string;
    reservationId: string;
    lineId: string;
    quantity: unknown;
    clientRequestId: unknown;
    actorKey: string;
  },
  sb?: FolioDb,
): Promise<StoredFolioLine> {
  const quantity = input.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > 9999
  ) {
    throw new FolioError("invalid_quantity", 400);
  }
  if (typeof input.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) {
    throw new FolioError("invalid_client_request_id", 400);
  }
  const db = await resolveDb(sb);
  if (typeof db.rpc !== "function") throw new FolioError("folio_write_not_atomic", 500);
  // Full immutable scope: the line must belong to THIS reservation's folio.
  const folio = await readFolioForReservation(input.tenantId, input.reservationId, db);
  if (!folio) throw new FolioError("line_not_found", 404);
  const row = await readScopedLine(db, input.tenantId, folio.id, input.lineId);
  if (!row) throw new FolioError("line_not_found", 404);
  if (row.line_type !== "add_on") throw new FolioError("line_not_editable", 400);
  if (row.status !== "draft") throw new FolioError("line_not_editable", 400);

  const subtotal = Number(row.unit_price_cents) * quantity;
  if (!Number.isSafeInteger(subtotal) || subtotal > 1e9) {
    throw new FolioError("invalid_amount", 400);
  }

  const fingerprint = await operationFingerprint(
    "folio.update_quantity",
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: folio.id,
      lineId: input.lineId,
    },
    { quantity },
  );
  const res = await db.rpc("hotelhub_update_folio_line_quantity", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_line_id: input.lineId,
    // Optimistic concurrency: the row we validated must still be the row the
    // transaction locks, otherwise a competing edit wins and we report it.
    p_expected_version: Number(row.version ?? 1),
    p_quantity: quantity,
    p_subtotal_cents: subtotal,
    p_tax_cents: 0,
    p_total_cents: subtotal,
    p_client_request_id: input.clientRequestId,
    p_actor_n3_user_key: input.actorKey,
    p_request_fingerprint: fingerprint,
  });
  const lineId = unwrapLineResult(res);
  const updated = await readScopedLine(db, input.tenantId, folio.id, lineId);
  if (!updated) throw new FolioError("folio_read_failed", 500);
  return toStoredLine(updated, new Map());
}

/** Owner-only manual adjustment or discount. Always signed, always reasoned. */
export async function addOwnerAdjustment(
  input: {
    tenantId: string;
    reservationId: string;
    lineType: unknown;
    description: unknown;
    amountCents: unknown;
    taxClass?: unknown;
    reason: unknown;
    clientRequestId: unknown;
    actorKey: string;
  },
  sb?: FolioDb,
): Promise<StoredFolioLine> {
  if (typeof input.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) {
    throw new FolioError("invalid_client_request_id", 400);
  }
  if (input.lineType !== "discount" && input.lineType !== "manual_adjustment") {
    throw new FolioError("invalid_line_type", 400);
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description || description.length > 160) throw new FolioError("invalid_description", 400);
  const amount = input.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || Math.abs(amount) > 1e9) {
    throw new FolioError("invalid_amount", 400);
  }
  if (amount === 0) throw new FolioError("invalid_amount", 400);
  if (input.lineType === "discount" && amount > 0) throw new FolioError("invalid_amount", 400);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3 || reason.length > 240) throw new FolioError("reason_required", 400);
  // A tax class is an enum, never free text.
  const taxClass = input.taxClass === undefined || input.taxClass === null ? null : input.taxClass;
  if (taxClass !== null && !isTaxClass(taxClass)) {
    throw new FolioError("invalid_tax_class", 400);
  }

  const db = await resolveDb(sb);
  const reservation = await readReservation(input.tenantId, input.reservationId, db);
  const folio = await ensureFolio(input.tenantId, input.reservationId, reservation.currency, db);

  const fingerprint = await operationFingerprint(
    "folio.adjustment",
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: folio.id,
      lineId: null,
    },
    { lineType: input.lineType, description, amountCents: amount, taxClass, reason },
  );
  const claim = await claimFolioOperation(db, {
    tenantId: input.tenantId,
    operation: "folio.adjustment",
    reservationId: input.reservationId,
    folioId: folio.id,
    lineId: null,
    clientRequestId: input.clientRequestId,
    fingerprint,
    actorKey: input.actorKey,
  });
  if (claim) {
    const replay = claim.replayLineId
      ? await readScopedLine(db, input.tenantId, folio.id, claim.replayLineId)
      : null;
    if (replay) return toStoredLine(replay, new Map());
    throw new FolioError("idempotency_conflict", 409);
  }

  const lineId = await atomicAddLine(db, {
    tenantId: input.tenantId,
    reservationId: input.reservationId,
    operation: "folio.adjustment",
    lineType: input.lineType,
    catalogueId: null,
    taxClass,
    description: description.slice(0, 160),
    quantity: 1,
    unitPriceCents: amount,
    subtotalCents: amount,
    taxSnapshot: { source: "owner_adjustment", taxClass },
    reason,
    clientRequestId: input.clientRequestId,
    fingerprint,
    actorKey: input.actorKey,
  });
  const row = await readScopedLine(db, input.tenantId, folio.id, lineId);
  if (!row) throw new FolioError("folio_read_failed", 500);
  return toStoredLine(row, new Map());
}

/**
 * Corrections are reversal-only, and the reversal is ATOMIC: the mirrored
 * negative line, the `reversed` status on the original and the idempotency
 * claim are written by one transactional database function
 * (`hotelhub_reverse_folio_line`). There is no two-statement path — a crash
 * can never leave a folio that is counted twice.
 */
export async function reverseFolioLine(
  input: {
    tenantId: string;
    reservationId: string;
    lineId: string;
    reason: unknown;
    clientRequestId: unknown;
    actorKey: string;
  },
  sb?: FolioDb,
): Promise<{ reversal: StoredFolioLine }> {
  if (typeof input.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) {
    throw new FolioError("invalid_client_request_id", 400);
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3 || reason.length > 240) throw new FolioError("reason_required", 400);

  const db = await resolveDb(sb);
  if (typeof db.rpc !== "function") {
    // Fail closed: a non-transactional fallback would be exactly the defect
    // this correction removes.
    throw new FolioError("reversal_not_atomic", 500);
  }
  const folio = await readFolioForReservation(input.tenantId, input.reservationId, db);
  if (!folio) throw new FolioError("line_not_found", 404);

  const fingerprint = await operationFingerprint(
    "folio.reverse",
    {
      tenantId: input.tenantId,
      reservationId: input.reservationId,
      folioId: folio.id,
      lineId: input.lineId,
    },
    { reason },
  );

  const res = await db.rpc("hotelhub_reverse_folio_line", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_line_id: input.lineId,
    p_reason: reason,
    p_client_request_id: input.clientRequestId,
    p_actor_n3_user_key: input.actorKey,
    p_request_fingerprint: fingerprint,
  });
  if (res.error) throw new FolioError("folio_write_failed", 500);
  const payload = res.data as { ok?: boolean; code?: string; lineId?: string | null } | null;
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    const code = typeof payload?.code === "string" ? payload.code : "folio_write_failed";
    throw new FolioError(code, folioErrorStatus(code));
  }
  const reversalId = typeof payload.lineId === "string" ? payload.lineId : null;
  const row = reversalId ? await readScopedLine(db, input.tenantId, folio.id, reversalId) : null;
  if (!row) throw new FolioError("folio_read_failed", 500);
  return { reversal: toStoredLine(row, new Map()) };
}

// -------------------------------------------------------------- folio view

export type FolioCapabilityInput = {
  canAddItem: boolean;
  canAdjust: boolean;
  canSetTaxClass: boolean;
  canManageCharges: boolean;
};

export async function buildFolioView(
  input: {
    tenantId: string;
    reservationId: string;
    actorKey: string;
    timezone: string;
    capability: FolioCapabilityInput;
  },
  sb?: FolioDb,
): Promise<FolioViewDTO> {
  const db = await resolveDb(sb);
  const reservation = await readReservation(input.tenantId, input.reservationId, db);
  // READ-ONLY. A GET never creates a folio and never snapshots a room night:
  // room-night snapshots are written by the check-in workflow and by the
  // explicit `refreshFolioRoomNights` endpoint.
  const folio = await readFolioForReservation(input.tenantId, input.reservationId, db);

  const { byRoomId, rooms } = await readReservationRooms(input.tenantId, input.reservationId, db);
  const roomLabelByReservationRoom = new Map<string, string>();
  const unmappedRoomLabels: string[] = [];
  for (const r of rooms) {
    const hotelRoom = byRoomId.get(r.hotel_room_id);
    const label = roomLabelOf(hotelRoom);
    roomLabelByReservationRoom.set(r.id, label);
    if (!hotelRoom?.n3_stock_id) unmappedRoomLabels.push(label);
  }

  const [linesResult, settings, taxProfile, evidence, catalogue] = await Promise.all([
    folio
      ? readFolioLines(input.tenantId, folio.id, db)
      : Promise.resolve({ rows: [] as LineRow[], lines: [] as StoredFolioLine[] }),
    readFinancialSettings(input.tenantId, db),
    readTaxProfile(input.tenantId, input.reservationId, db),
    listTourismTaxEvidence(input.tenantId, input.reservationId, db),
    listAddonItems(input.tenantId, {}, db),
  ]);
  const { lines, rows } = linesResult;

  const decorated: StoredFolioLine[] = lines.map((l) => ({
    ...l,
    roomLabel: l.reservationRoomId
      ? (roomLabelByReservationRoom.get(l.reservationRoomId) ?? null)
      : null,
  }));

  const usedCatalogueIds = new Set(
    rows.filter((r) => r.catalogue_id).map((r) => r.catalogue_id as string),
  );
  const unmappedAddonNames = catalogue
    .filter((i) => usedCatalogueIds.has(i.id) && mappingStatus(i) !== "mapped")
    .map((i) => i.displayName);

  const propertyDate = propertyTodayIso(input.timezone) ?? new Date().toISOString().slice(0, 10);
  const occupiedRoomNights = decorated.filter(
    (l) => l.lineType === "room_night" && isEffectiveLine(l),
  ).length;

  const computed = computeFolio({
    currency: reservation.currency,
    settings,
    lines: decorated,
    guestTaxClass: taxProfile.guestTaxClass,
    occupiedRoomNights,
    tourismTaxCollectedCents: evidence.totalCents,
    propertyDate,
    unmappedRoomLabels,
    unmappedAddonNames,
  });

  const reversedTargets = new Set(
    decorated.filter((l) => l.reversesLineId).map((l) => l.reversesLineId as string),
  );

  const lineDTOs: FolioLineDTO[] = decorated.map((l) => ({
    id: l.id,
    lineType: l.lineType,
    status: l.status,
    taxClass: l.taxClass,
    description: l.description,
    quantity: l.quantity,
    unitPrice: centsToAmount(l.unitPriceCents),
    amount: centsToAmount(l.subtotalCents),
    stayDate: l.stayDate,
    roomLabel: l.roomLabel,
    reason: l.reason,
    reversesLineId: l.reversesLineId,
    actorLabel: l.actorLabel,
    createdAt: l.createdAt,
    canEditQuantity: input.capability.canAddItem && l.lineType === "add_on" && l.status === "draft",
    canReverse:
      input.capability.canAdjust &&
      l.lineType !== "room_night" &&
      l.lineType !== "reversal" &&
      l.status !== "reversed" &&
      !reversedTargets.has(l.id),
  }));

  const derived: FolioDerivedLineDTO[] = computed.derived.map((d) => ({
    key: d.key,
    lineType: d.lineType,
    description: d.description,
    quantity: d.quantity,
    unitPrice: centsToAmount(d.unitPriceCents),
    amount: centsToAmount(d.amountCents),
  }));

  const primaryGuest = await readPrimaryGuestName(input.tenantId, input.reservationId, db);

  const catalogueOptions: FolioCatalogueOptionDTO[] = input.capability.canAddItem
    ? catalogue.filter(isUsableAddon).map((i) => ({
        id: i.id,
        displayName: i.displayName,
        category: i.category,
        taxClass: i.taxClass,
        defaultUnitPrice: centsToAmount(i.defaultUnitPriceCents),
      }))
    : [];

  const evidenceDTOs: TourismTaxEvidenceDTO[] = evidence.rows.map((r) => ({
    id: r.id,
    sourceLabel: r.source_label,
    reference: r.reference,
    collectedOn: r.collected_on,
    amount: centsToAmount(Number(r.amount_cents)),
    note: r.note,
    createdAt: r.created_at,
  }));

  return {
    reservation: {
      id: reservation.id,
      bookingReference: reservation.booking_reference,
      arrivalDate: reservation.arrival_date,
      departureDate: reservation.departure_date,
      currency: reservation.currency,
      primaryGuestName: primaryGuest,
      roomLabels: Array.from(new Set(roomLabelByReservationRoom.values())),
    },
    propertyDate,
    guestTaxClass: taxProfile.guestTaxClass,
    evidenceNote: taxProfile.evidenceNote,
    tourismTaxEvidence: evidenceDTOs,
    occupiedRoomNights,
    lines: lineDTOs,
    derived,
    totals: {
      charges: centsToAmount(computed.totals.chargesCents),
      serviceCharge: centsToAmount(computed.totals.serviceChargeCents),
      serviceTax: centsToAmount(computed.totals.serviceTaxCents),
      tourismTax: centsToAmount(computed.totals.tourismTaxCents),
      localLevy: centsToAmount(computed.totals.localLevyCents),
      rounding: centsToAmount(computed.totals.roundingCents),
      grandTotal: centsToAmount(computed.totals.grandTotalCents),
    },
    blockers: computed.blockers,
    readiness: {
      ...folioReadinessProjection(settings),
      calculationComplete: computed.calculationComplete,
    },
    catalogue: catalogueOptions,
    capability: {
      canView: true,
      canAddItem: input.capability.canAddItem,
      canAdjust: input.capability.canAdjust,
      canSetTaxClass: input.capability.canSetTaxClass,
      canManageCharges: input.capability.canManageCharges,
    },
    preparationOnly: true,
  };
}

async function readPrimaryGuestName(
  tenantId: string,
  reservationId: string,
  db: FolioDb,
): Promise<string | null> {
  const res = await db
    .from<{ is_primary: boolean; guest_id: string }>("hotel_reservation_guests")
    .select("is_primary, guest_id")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId);
  if (res.error) return null;
  const primary = (res.data ?? []).find((g) => g.is_primary) ?? (res.data ?? [])[0];
  if (!primary) return null;
  const guest = await db
    .from<{ full_name: string }>("hotel_guests")
    .select("full_name")
    .eq("tenant_id", tenantId)
    .eq("id", primary.guest_id)
    .maybeSingle();
  if (guest.error) return null;
  return guest.data?.full_name ?? null;
}
