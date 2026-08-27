// HH-GOLIVE-01A — tenant add-on catalogue: pure domain rules.
//
// A catalogue item is usable on a folio ONLY when it is active AND fully
// mapped to immutable N3 identifiers. Unmapped items stay visible in
// Settings with an explicit mapping status, and are blocked from use.

export type AddonCategory =
  | "minibar"
  | "breakfast"
  | "laundry"
  | "extra_bed"
  | "early_check_in"
  | "late_checkout"
  | "transport"
  | "room_service"
  | "damage_lost_item"
  | "other";

export const ADDON_CATEGORIES: readonly AddonCategory[] = [
  "minibar",
  "breakfast",
  "laundry",
  "extra_bed",
  "early_check_in",
  "late_checkout",
  "transport",
  "room_service",
  "damage_lost_item",
  "other",
] as const;

export const ADDON_CATEGORY_LABELS: Record<AddonCategory, string> = {
  minibar: "Minibar",
  breakfast: "Breakfast",
  laundry: "Laundry",
  extra_bed: "Extra bed",
  early_check_in: "Early check-in",
  late_checkout: "Late checkout",
  transport: "Transport",
  room_service: "Room service",
  damage_lost_item: "Damage / lost item",
  other: "Other",
};

/**
 * Tax/charge classification. Kept separate from the merchandising category
 * because two items in the same category can be taxed differently.
 */
export type TaxClass =
  | "accommodation"
  | "food_and_beverage"
  | "parking"
  | "other_taxable_service"
  | "non_taxable"
  | "service_charge"
  | "damage_compensation";

export const TAX_CLASSES: readonly TaxClass[] = [
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
  "non_taxable",
  "service_charge",
  "damage_compensation",
] as const;

export const TAX_CLASS_LABELS: Record<TaxClass, string> = {
  accommodation: "Accommodation",
  food_and_beverage: "Food & beverage",
  parking: "Parking",
  other_taxable_service: "Other taxable service",
  non_taxable: "Not taxable",
  service_charge: "Service charge (commercial)",
  damage_compensation: "Damage / compensation",
};

/** Classes that can attract Service Tax when the property is registered. */
export const TAXABLE_CLASSES: readonly TaxClass[] = [
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
] as const;

export function isAddonCategory(v: unknown): v is AddonCategory {
  return typeof v === "string" && (ADDON_CATEGORIES as readonly string[]).includes(v);
}

export function isTaxClass(v: unknown): v is TaxClass {
  return typeof v === "string" && (TAX_CLASSES as readonly string[]).includes(v);
}

export function isTaxableClass(v: TaxClass): boolean {
  return (TAXABLE_CLASSES as readonly string[]).includes(v);
}

export type AddonItem = {
  id: string;
  category: AddonCategory;
  taxClass: TaxClass;
  displayName: string;
  description: string | null;
  isActive: boolean;
  defaultUnitPriceCents: number;
  n3StockId: string | null;
  n3UomId: string | null;
  n3TaxCodeId: string | null;
  n3StockCodeSnapshot: string | null;
  n3StockNameSnapshot: string | null;
  n3UomSnapshot: string | null;
  n3TaxCodeSnapshot: string | null;
  sortOrder: number;
};

export type MappingStatus = "mapped" | "incomplete";

/** Which immutable N3 identifiers are still missing for this item. */
export function missingMappings(item: Pick<AddonItem, "n3StockId" | "n3UomId" | "n3TaxCodeId">) {
  const missing: string[] = [];
  if (!item.n3StockId) missing.push("stock");
  if (!item.n3UomId) missing.push("uom");
  if (!item.n3TaxCodeId) missing.push("taxCode");
  return missing;
}

export function mappingStatus(
  item: Pick<AddonItem, "n3StockId" | "n3UomId" | "n3TaxCodeId">,
): MappingStatus {
  return missingMappings(item).length === 0 ? "mapped" : "incomplete";
}

/** Usable on a folio: active AND completely mapped. */
export function isUsableAddon(item: AddonItem): boolean {
  return item.isActive && mappingStatus(item) === "mapped";
}

export const ADDON_NAME_MAX = 80;
export const ADDON_DESCRIPTION_MAX = 240;

export type AddonInput = {
  category?: unknown;
  taxClass?: unknown;
  displayName?: unknown;
  description?: unknown;
  isActive?: unknown;
  defaultUnitPriceCents?: unknown;
  n3StockId?: unknown;
  n3UomId?: unknown;
  n3TaxCodeId?: unknown;
  n3StockCodeSnapshot?: unknown;
  n3StockNameSnapshot?: unknown;
  n3UomSnapshot?: unknown;
  n3TaxCodeSnapshot?: unknown;
  sortOrder?: unknown;
};

export type AddonValidation =
  | { ok: true; value: Omit<AddonItem, "id"> }
  | { ok: false; code: string };

function optionalId(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= 120 ? t : undefined;
}

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

/**
 * Validate a complete catalogue item. Mapping fields are optional here — an
 * unmapped item may be SAVED (so the Owner can finish it later) but is
 * blocked from folio use by `isUsableAddon`.
 */
export function validateAddonInput(input: AddonInput): AddonValidation {
  if (!isAddonCategory(input.category)) return { ok: false, code: "invalid_category" };
  if (!isTaxClass(input.taxClass)) return { ok: false, code: "invalid_tax_class" };
  if (typeof input.displayName !== "string") return { ok: false, code: "invalid_display_name" };
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > ADDON_NAME_MAX) {
    return { ok: false, code: "invalid_display_name" };
  }
  const description = optionalText(input.description, ADDON_DESCRIPTION_MAX);
  if (description === undefined && input.description !== undefined) {
    return { ok: false, code: "invalid_description" };
  }
  const price = input.defaultUnitPriceCents;
  if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0 || price > 1e9) {
    return { ok: false, code: "invalid_unit_price" };
  }
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    return { ok: false, code: "invalid_active_flag" };
  }
  const sortOrder = input.sortOrder;
  if (
    sortOrder !== undefined &&
    (typeof sortOrder !== "number" || !Number.isSafeInteger(sortOrder) || sortOrder < 0)
  ) {
    return { ok: false, code: "invalid_sort_order" };
  }
  const ids = {
    n3StockId: optionalId(input.n3StockId),
    n3UomId: optionalId(input.n3UomId),
    n3TaxCodeId: optionalId(input.n3TaxCodeId),
  };
  for (const [k, v] of Object.entries(ids)) {
    if (v === undefined && (input as Record<string, unknown>)[k] !== undefined) {
      return { ok: false, code: "invalid_n3_mapping" };
    }
  }
  return {
    ok: true,
    value: {
      category: input.category,
      taxClass: input.taxClass,
      displayName,
      description: description ?? null,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      defaultUnitPriceCents: price,
      n3StockId: ids.n3StockId ?? null,
      n3UomId: ids.n3UomId ?? null,
      n3TaxCodeId: ids.n3TaxCodeId ?? null,
      n3StockCodeSnapshot: optionalText(input.n3StockCodeSnapshot, 120) ?? null,
      n3StockNameSnapshot: optionalText(input.n3StockNameSnapshot, 160) ?? null,
      n3UomSnapshot: optionalText(input.n3UomSnapshot, 60) ?? null,
      n3TaxCodeSnapshot: optionalText(input.n3TaxCodeSnapshot, 60) ?? null,
      sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
    },
  };
}
