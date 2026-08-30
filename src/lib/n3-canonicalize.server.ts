// HH-GOLIVE-01A UAT correction (blocker 1) — server-authoritative N3 mappings.
//
// A browser may only ever propose an IMMUTABLE N3 identifier. It is never
// trusted for the human-readable code/name snapshot, and never trusted that
// the identifier exists at all. Before anything is stored, the server re-reads
// the authoritative allow-listed N3 list with the server-side token, matches
// the submitted identifier, and stores the canonical code/name returned by N3.
//
// Fail-closed rules:
//   * unproven contract (tax code / unit of measure) → non-null submission is
//     refused with a stable contract-unverified error; clearing stays allowed;
//   * identifier absent / inactive / ineligible → refused, nothing is saved;
//   * N3 unreachable → refused, nothing is saved (never a partial save);
//   * `resolvedAccount` is server-owned and can never be supplied by a browser.
//
// The N3 read is INJECTED (`SelectorLoader`) so this module is exercised by
// real behavioural tests without any network access.
import {
  boundedN3Id,
  N3_SELECTOR_CONTRACTS,
  type N3SelectorContext,
  type N3SelectorKind,
  type N3SelectorLoad,
} from "./n3-selectors";
import type { SettingsPatch } from "./financial-settings";
import {
  emptySnapshot,
  type N3Snapshot,
  type PostingComponent,
  type PostingMappings,
} from "./posting-mappings";

/** Reads the complete authoritative list for one proven selector kind. */
export type SelectorLoader = (
  kind: N3SelectorKind,
  ctx?: N3SelectorContext,
) => Promise<N3SelectorLoad>;

export const CANONICALIZE_ERRORS = {
  contractUnverified: "n3_contract_unverified",
  notFound: "n3_reference_not_found",
  unavailable: "n3_validation_unavailable",
  resolvedAccountServerOwned: "resolved_account_is_server_owned",
  invalidMapping: "invalid_n3_mapping",
  /** A unit of measure was requested without an effective N3 Stock. */
  uomRequiresStock: "n3_uom_requires_stock",
  /** The effective unit of measure does not belong to the effective Stock. */
  uomStockMismatch: "n3_uom_stock_mismatch",
  /** The chosen Output Tax code has no usable live rate in N3. */
  taxRateUnavailable: "n3_tax_rate_unavailable",
} as const;

export type CanonicalError = (typeof CANONICALIZE_ERRORS)[keyof typeof CANONICALIZE_ERRORS];

export type CanonicalOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

/** HTTP status for each canonicalization failure. Sanitized, stable. */
export function canonicalErrorStatus(code: string): number {
  switch (code) {
    case CANONICALIZE_ERRORS.contractUnverified:
    case CANONICALIZE_ERRORS.uomRequiresStock:
    case CANONICALIZE_ERRORS.uomStockMismatch:
    case CANONICALIZE_ERRORS.taxRateUnavailable:
      return 422;
    case CANONICALIZE_ERRORS.unavailable:
      return 503;
    case CANONICALIZE_ERRORS.notFound:
    case CANONICALIZE_ERRORS.resolvedAccountServerOwned:
    case CANONICALIZE_ERRORS.invalidMapping:
      return 400;
    default:
      return 400;
  }
}

/**
 * Resolve one submitted identifier to the canonical N3 snapshot.
 * `null` clears the mapping and never touches N3.
 */
export async function canonicalizeN3Reference(
  kind: N3SelectorKind,
  submittedId: string | null | undefined,
  load: SelectorLoader | undefined,
  ctx?: N3SelectorContext,
): Promise<CanonicalOutcome<N3Snapshot>> {
  if (submittedId === null || submittedId === undefined || submittedId === "") {
    return { ok: true, value: emptySnapshot() };
  }
  if (!N3_SELECTOR_CONTRACTS[kind].proven) {
    return { ok: false, code: CANONICALIZE_ERRORS.contractUnverified };
  }
  if (!load) return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  let loaded: N3SelectorLoad;
  try {
    loaded = await load(kind, ctx);
  } catch {
    return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  }
  if (loaded.status === "contract_unverified") {
    return { ok: false, code: CANONICALIZE_ERRORS.contractUnverified };
  }
  if (loaded.status === "stock_context_required") {
    return { ok: false, code: CANONICALIZE_ERRORS.uomRequiresStock };
  }
  if (loaded.status !== "ok") return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  const row = loaded.items.find((r) => r.id === submittedId);
  // Absent from the COMPLETE current list = fabricated, inactive or ineligible.
  if (!row) return { ok: false, code: CANONICALIZE_ERRORS.notFound };
  return { ok: true, value: { id: row.id, code: row.code, name: row.name ?? null } };
}

/**
 * Resolve an Output Tax code AND its authoritative live rate.
 *
 * N3 is the sole source of a Service Tax rate. A rate submitted by a browser is
 * never trusted and never kept: the caller discards it and stores only the live
 * N3 rate. When N3 declares no usable rate for the chosen code, nothing is
 * guessed — `rateBp` is null and the save is refused outright.
 */
export async function canonicalizeTaxCodeWithRate(
  submittedId: string | null | undefined,
  load: SelectorLoader | undefined,
): Promise<CanonicalOutcome<{ snapshot: N3Snapshot; rateBp: number | null }>> {
  const resolved = await canonicalizeN3Reference("tax_code", submittedId, load);
  if (!resolved.ok) return resolved;
  if (!resolved.value.id) return { ok: true, value: { snapshot: resolved.value, rateBp: null } };
  let rateBp: number | null = null;
  try {
    const loaded = await load!("tax_code");
    if (loaded.status === "ok") {
      const row = loaded.items.find((r) => r.id === resolved.value.id);
      rateBp = typeof row?.rateBp === "number" ? row.rateBp : null;
    }
  } catch {
    return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  }
  return { ok: true, value: { snapshot: resolved.value, rateBp } };
}

/**
 * Resolve a unit of measure against the STOCK it must belong to.
 *
 * The server re-reads the current N3 UOM list filtered to the effective Stock,
 * so a UOM that belongs to another Stock — including one left behind by an
 * earlier Stock choice — is refused with a stable, sanitized mismatch error
 * rather than silently saved or guessed.
 */
export async function canonicalizeUomForStock(
  uomId: string | null,
  stockId: string | null,
  load: SelectorLoader | undefined,
): Promise<CanonicalOutcome<N3Snapshot>> {
  if (!uomId) return { ok: true, value: emptySnapshot() };
  if (!stockId) return { ok: false, code: CANONICALIZE_ERRORS.uomRequiresStock };
  const r = await canonicalizeN3Reference("uom", uomId, load, { stockId });
  // Not present in the stock-filtered list means the pair is incompatible.
  if (!r.ok && r.code === CANONICALIZE_ERRORS.notFound) {
    return { ok: false, code: CANONICALIZE_ERRORS.uomStockMismatch };
  }
  return r;
}

// ------------------------------------------------- financial settings patch

/**
 * Rewrite an already-shape-validated settings patch so every N3 reference is
 * the canonical server-resolved value. Browser snapshots are discarded.
 *
 * `currentMappings` supplies the already-persisted posting mappings so a
 * PARTIAL patch is validated against the EFFECTIVE stock/UOM pair, not only
 * the submitted fields.
 */
export async function canonicalizeSettingsPatch(
  patch: SettingsPatch,
  load: SelectorLoader | undefined,
  currentMappings?: PostingMappings,
): Promise<CanonicalOutcome<SettingsPatch>> {
  const next: SettingsPatch = { ...patch };

  if (patch.serviceTax) {
    const out: NonNullable<SettingsPatch["serviceTax"]> = {};
    for (const [key, mapping] of Object.entries(patch.serviceTax)) {
      const cleaned = { ...(mapping ?? {}) };
      // Snapshots are NEVER taken from the browser.
      delete cleaned.n3TaxCodeSnapshot;
      // A Service Tax rate can only ever come from the live N3 Output Tax
      // code. A browser-submitted rate is discarded before anything is stored.
      delete cleaned.rateBp;
      if (mapping && "n3TaxCodeId" in mapping) {
        const r = await canonicalizeTaxCodeWithRate(mapping.n3TaxCodeId ?? null, load);
        if (!r.ok) return r;
        cleaned.n3TaxCodeId = r.value.snapshot.id;
        cleaned.n3TaxCodeSnapshot = r.value.snapshot.code;
        if (!r.value.snapshot.id) {
          // Clearing the tax code clears the rate with it — a stale rate must
          // never survive its source.
          cleaned.rateBp = null;
        } else if (r.value.rateBp === null) {
          // A chosen tax code whose live N3 rate is missing or malformed is a
          // legal problem, not a convenience: the whole save is rejected.
          return { ok: false, code: CANONICALIZE_ERRORS.taxRateUnavailable };
        } else {
          cleaned.rateBp = r.value.rateBp;
        }
      }
      out[key as keyof NonNullable<SettingsPatch["serviceTax"]>] = cleaned;
    }
    next.serviceTax = out;
  }

  if (patch.exempt) {
    const r = await canonicalizeN3Reference("tax_code", patch.exempt.n3TaxCodeId ?? null, load);
    if (!r.ok) return r;
    next.exempt = { n3TaxCodeId: r.value.id, n3TaxCodeSnapshot: r.value.code };
  }

  if (patch.rounding) {
    const rounding = { ...patch.rounding };
    if ("n3RoundingAccountId" in patch.rounding || "n3RoundingAccountSnapshot" in patch.rounding) {
      const r = await canonicalizeN3Reference(
        "gl_account",
        patch.rounding.n3RoundingAccountId ?? null,
        load,
      );
      if (!r.ok) return r;
      rounding.n3RoundingAccountId = r.value.id;
      rounding.n3RoundingAccountSnapshot = r.value.name
        ? `${r.value.code} — ${r.value.name}`
        : r.value.code;
    }
    next.rounding = rounding;
  }

  if (patch.postingMappings) {
    const out: NonNullable<SettingsPatch["postingMappings"]> = {};
    for (const [component, value] of Object.entries(patch.postingMappings)) {
      if (!value) continue;
      // The destination account is server-owned until a proven stock-to-account
      // resolution contract exists. A browser can never supply it.
      if (value.resolvedAccount && value.resolvedAccount.id) {
        return { ok: false, code: CANONICALIZE_ERRORS.resolvedAccountServerOwned };
      }
      const cleaned: NonNullable<SettingsPatch["postingMappings"]>[PostingComponent] = {};
      if (value.enabled !== undefined) cleaned.enabled = value.enabled;

      const persisted = currentMappings?.[component as PostingComponent];
      const stockSubmitted = "stock" in value;
      const uomSubmitted = "uom" in value;
      const persistedStockId = persisted?.stock.id ?? null;
      const persistedUomId = persisted?.uom.id ?? null;

      let effectiveStockId = persistedStockId;
      if (stockSubmitted) {
        const r = await canonicalizeN3Reference("stock", value.stock?.id ?? null, load);
        if (!r.ok) return r;
        cleaned.stock = r.value;
        effectiveStockId = r.value.id;
      }

      if ("taxCode" in value) {
        const r = await canonicalizeN3Reference("tax_code", value.taxCode?.id ?? null, load);
        if (!r.ok) return r;
        cleaned.taxCode = r.value;
      }

      // The effective pair is revalidated whenever either half moves, so a
      // changed Stock can never retain an incompatible earlier UOM.
      const stockChanged = stockSubmitted && effectiveStockId !== persistedStockId;
      const effectiveUomId = uomSubmitted ? (value.uom?.id ?? null) : persistedUomId;
      if (uomSubmitted || (stockChanged && effectiveUomId)) {
        const r = await canonicalizeUomForStock(effectiveUomId, effectiveStockId, load);
        if (!r.ok) return r;
        cleaned.uom = r.value;
      }

      if ("resolvedAccount" in value) cleaned.resolvedAccount = emptySnapshot();
      out[component as PostingComponent] = cleaned;
    }
    next.postingMappings = out;
  }

  return { ok: true, value: next };
}

// --------------------------------------------------------- catalogue input

const ADDON_SNAPSHOT_FIELDS = [
  "n3StockCodeSnapshot",
  "n3StockNameSnapshot",
  "n3UomSnapshot",
  "n3TaxCodeSnapshot",
] as const;

/** The already-persisted N3 pair for a partial catalogue update. */
export type AddonCurrentMapping = {
  n3StockId: string | null;
  n3UomId: string | null;
};

/**
 * Rewrite a catalogue create/update body so N3 mappings are canonical.
 * Browser-supplied snapshots are always discarded, whether or not the
 * matching identifier was submitted.
 *
 * `current` supplies the persisted stock/UOM pair so a PARTIAL update is
 * validated against the EFFECTIVE pair. Changing the Stock without choosing a
 * compatible unit of measure fails atomically before any database write.
 */
export async function canonicalizeAddonInput(
  input: Record<string, unknown>,
  load: SelectorLoader | undefined,
  current?: AddonCurrentMapping,
): Promise<CanonicalOutcome<Record<string, unknown>>> {
  const next: Record<string, unknown> = { ...input };
  for (const field of ADDON_SNAPSHOT_FIELDS) delete next[field];

  // Shape validation for every submitted identifier happens first, so a
  // malformed value fails closed before any selector load or DB write.
  const ids: Partial<Record<"n3StockId" | "n3UomId" | "n3TaxCodeId", string | null>> = {};
  for (const field of ["n3StockId", "n3UomId", "n3TaxCodeId"] as const) {
    if (!(field in input)) continue;
    const parsed = parseSubmittedId(input[field]);
    if (!parsed.ok) return parsed;
    ids[field] = parsed.value;
  }

  const persistedStockId = current?.n3StockId ?? null;
  const persistedUomId = current?.n3UomId ?? null;
  const stockSubmitted = "n3StockId" in input;
  const uomSubmitted = "n3UomId" in input;

  let effectiveStockId = persistedStockId;
  if (stockSubmitted) {
    const r = await canonicalizeN3Reference("stock", ids.n3StockId ?? null, load);
    if (!r.ok) return r;
    next.n3StockId = r.value.id;
    next.n3StockCodeSnapshot = r.value.code;
    next.n3StockNameSnapshot = r.value.name;
    effectiveStockId = r.value.id;
  }

  // Stock-linked unit of measure: revalidate the EFFECTIVE pair whenever
  // either half moves, so a stale UOM can never survive a Stock change.
  const stockChanged = stockSubmitted && effectiveStockId !== persistedStockId;
  const effectiveUomId = uomSubmitted ? (ids.n3UomId ?? null) : persistedUomId;
  if (uomSubmitted || (stockChanged && effectiveUomId)) {
    const r = await canonicalizeUomForStock(effectiveUomId, effectiveStockId, load);
    if (!r.ok) return r;
    next.n3UomId = r.value.id;
    next.n3UomSnapshot = r.value.code;
  }

  if ("n3TaxCodeId" in input) {
    const r = await canonicalizeN3Reference("tax_code", ids.n3TaxCodeId ?? null, load);
    if (!r.ok) return r;
    next.n3TaxCodeId = r.value.id;
    next.n3TaxCodeSnapshot = r.value.code;
  }
  return { ok: true, value: next };
}

/** Re-exported so callers keep one single bound for N3 identifier length. */
export { MAX_N3_ID_LENGTH } from "./n3-selectors";

/**
 * Explicit null (or the accepted empty/whitespace form) clears the mapping.
 * Any other value must be a string of at most MAX_N3_ID_LENGTH characters.
 */
function parseSubmittedId(v: unknown): CanonicalOutcome<string | null> {
  const parsed = boundedN3Id(v);
  if (parsed === undefined) return { ok: false, code: CANONICALIZE_ERRORS.invalidMapping };
  return { ok: true, value: parsed };
}
