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
import { N3_SELECTOR_CONTRACTS, type N3SelectorKind, type N3SelectorLoad } from "./n3-selectors";
import type { SettingsPatch } from "./financial-settings";
import { emptySnapshot, type N3Snapshot, type PostingComponent } from "./posting-mappings";

/** Reads the complete authoritative list for one proven selector kind. */
export type SelectorLoader = (kind: N3SelectorKind) => Promise<N3SelectorLoad>;

export const CANONICALIZE_ERRORS = {
  contractUnverified: "n3_contract_unverified",
  notFound: "n3_reference_not_found",
  unavailable: "n3_validation_unavailable",
  resolvedAccountServerOwned: "resolved_account_is_server_owned",
} as const;

export type CanonicalError = (typeof CANONICALIZE_ERRORS)[keyof typeof CANONICALIZE_ERRORS];

export type CanonicalOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

/** HTTP status for each canonicalization failure. Sanitized, stable. */
export function canonicalErrorStatus(code: string): number {
  switch (code) {
    case CANONICALIZE_ERRORS.contractUnverified:
      return 422;
    case CANONICALIZE_ERRORS.unavailable:
      return 503;
    case CANONICALIZE_ERRORS.notFound:
    case CANONICALIZE_ERRORS.resolvedAccountServerOwned:
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
    loaded = await load(kind);
  } catch {
    return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  }
  if (loaded.status === "contract_unverified") {
    return { ok: false, code: CANONICALIZE_ERRORS.contractUnverified };
  }
  if (loaded.status !== "ok") return { ok: false, code: CANONICALIZE_ERRORS.unavailable };
  const row = loaded.items.find((r) => r.id === submittedId);
  // Absent from the COMPLETE current list = fabricated, inactive or ineligible.
  if (!row) return { ok: false, code: CANONICALIZE_ERRORS.notFound };
  return { ok: true, value: { id: row.id, code: row.code, name: row.name ?? null } };
}

// ------------------------------------------------- financial settings patch

/**
 * Rewrite an already-shape-validated settings patch so every N3 reference is
 * the canonical server-resolved value. Browser snapshots are discarded.
 */
export async function canonicalizeSettingsPatch(
  patch: SettingsPatch,
  load: SelectorLoader | undefined,
): Promise<CanonicalOutcome<SettingsPatch>> {
  const next: SettingsPatch = { ...patch };

  if (patch.serviceTax) {
    const out: NonNullable<SettingsPatch["serviceTax"]> = {};
    for (const [key, mapping] of Object.entries(patch.serviceTax)) {
      const cleaned = { ...(mapping ?? {}) };
      // Snapshots are NEVER taken from the browser.
      delete cleaned.n3TaxCodeSnapshot;
      if (mapping && "n3TaxCodeId" in mapping) {
        const r = await canonicalizeN3Reference("tax_code", mapping.n3TaxCodeId ?? null, load);
        if (!r.ok) return r;
        cleaned.n3TaxCodeId = r.value.id;
        cleaned.n3TaxCodeSnapshot = r.value.code;
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
      for (const [field, kind] of [
        ["stock", "stock"],
        ["uom", "uom"],
        ["taxCode", "tax_code"],
      ] as const) {
        if (!(field in value)) continue;
        const r = await canonicalizeN3Reference(kind, value[field]?.id ?? null, load);
        if (!r.ok) return r;
        cleaned[field] = r.value;
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

/**
 * Rewrite a catalogue create/update body so N3 mappings are canonical.
 * Browser-supplied snapshots are always discarded, whether or not the
 * matching identifier was submitted.
 */
export async function canonicalizeAddonInput(
  input: Record<string, unknown>,
  load: SelectorLoader | undefined,
): Promise<CanonicalOutcome<Record<string, unknown>>> {
  const next: Record<string, unknown> = { ...input };
  for (const field of ADDON_SNAPSHOT_FIELDS) delete next[field];

  if ("n3StockId" in input) {
    const r = await canonicalizeN3Reference("stock", asId(input.n3StockId), load);
    if (!r.ok) return r;
    next.n3StockId = r.value.id;
    next.n3StockCodeSnapshot = r.value.code;
    next.n3StockNameSnapshot = r.value.name;
  }
  if ("n3UomId" in input) {
    const r = await canonicalizeN3Reference("uom", asId(input.n3UomId), load);
    if (!r.ok) return r;
    next.n3UomId = r.value.id;
    next.n3UomSnapshot = r.value.code;
  }
  if ("n3TaxCodeId" in input) {
    const r = await canonicalizeN3Reference("tax_code", asId(input.n3TaxCodeId), load);
    if (!r.ok) return r;
    next.n3TaxCodeId = r.value.id;
    next.n3TaxCodeSnapshot = r.value.code;
  }
  return { ok: true, value: next };
}

function asId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
