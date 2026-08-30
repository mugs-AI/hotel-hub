// HH-GOLIVE-01A UAT correction — future-posting accounting mappings.
//
// PREPARATION ONLY. Nothing in this milestone posts to N3. This module is the
// smallest tenant-scoped model that records, per chargeable component, which
// N3 stock / unit of measure / tax code the later posting milestone must use,
// together with the verification state of each snapshot.
//
// Deliberate rules:
//   * A GL account label is never invented. The destination account is
//     whatever the mapped N3 Stock resolves to; when that cannot be proven the
//     component reads "Unable to verify accounting destination" and readiness
//     is blocked. There is no typed-account fallback.
//   * Tourism Tax and any state/local levy use their own dedicated mappings.
//     They are liability-intended, but HotelHub never asserts a GL label for
//     them — the mapped N3 master carries that meaning.
//   * Every identifier stored here must have come from a server-loaded N3
//     selector row. Free text is rejected by `validatePostingMappingPatch`.
//
// PURE module: no I/O, no secrets.

export const POSTING_COMPONENTS = [
  "service_charge",
  "tourism_tax",
  "local_levy",
  "discount",
  "adjustment_positive",
  "adjustment_negative",
] as const;

export type PostingComponent = (typeof POSTING_COMPONENTS)[number];

export function isPostingComponent(v: unknown): v is PostingComponent {
  return typeof v === "string" && (POSTING_COMPONENTS as readonly string[]).includes(v);
}

export const POSTING_COMPONENT_LABELS: Record<PostingComponent, string> = {
  service_charge: "Service charge",
  tourism_tax: "Tourism Tax",
  local_levy: "State / local levy",
  discount: "Discount",
  adjustment_positive: "Adjustment (increase)",
  adjustment_negative: "Adjustment (reduction)",
};

/** Plain-English hint shown under each component in Owner Settings. */
export const POSTING_COMPONENT_HINTS: Record<PostingComponent, string> = {
  service_charge: "Your own commercial charge — not a government tax.",
  tourism_tax: "Collected from foreign guests and owed onwards.",
  local_levy: "A state or council levy you collect and owe onwards.",
  discount: "Reductions you give a guest on the prepared folio.",
  adjustment_positive: "A manual increase a supervisor adds to the folio.",
  adjustment_negative: "A manual reduction a supervisor applies to the folio.",
};

/**
 * Verification state of a mapping snapshot.
 *  * `unverified` — never confirmed against N3 (fresh, or storage not ready).
 *  * `verified`   — every mapped master was present and active when checked.
 *  * `drifted`    — a mapped master changed code/name or became inactive.
 *  * `unavailable`— N3 could not be consulted; treated exactly as not ready.
 */
export type MappingVerification = "unverified" | "verified" | "drifted" | "unavailable";

export const MAPPING_VERIFICATION_LABELS: Record<MappingVerification, string> = {
  unverified: "Not yet checked",
  verified: "Checked and active",
  drifted: "Changed in N3 — recheck",
  unavailable: "Could not be checked",
};

export type N3Snapshot = {
  /** Immutable N3 identifier, chosen from a selector. Never typed. */
  id: string | null;
  /** Human-readable code captured at selection time. Display only. */
  code: string | null;
  /** Human-readable name captured at selection time. Display only. */
  name: string | null;
};

export type PostingMapping = {
  component: PostingComponent;
  /** Only enabled components are required for readiness. */
  enabled: boolean;
  stock: N3Snapshot;
  uom: N3Snapshot;
  taxCode: N3Snapshot;
  /**
   * The account the mapped Stock resolves to, as reported by N3. `null` means
   * HotelHub could not prove the destination and must say so.
   */
  resolvedAccount: N3Snapshot;
  verification: MappingVerification;
  verifiedAt: string | null;
};

export type PostingMappings = Record<PostingComponent, PostingMapping>;

export function emptySnapshot(): N3Snapshot {
  return { id: null, code: null, name: null };
}

export function defaultPostingMapping(component: PostingComponent): PostingMapping {
  return {
    component,
    enabled: false,
    stock: emptySnapshot(),
    uom: emptySnapshot(),
    taxCode: emptySnapshot(),
    resolvedAccount: emptySnapshot(),
    verification: "unverified",
    verifiedAt: null,
  };
}

export function defaultPostingMappings(): PostingMappings {
  const out = {} as PostingMappings;
  for (const c of POSTING_COMPONENTS) out[c] = defaultPostingMapping(c);
  return out;
}

// --------------------------------------------------------------- validation

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textOrNull(v: unknown, max = 200): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

function snapshot(v: unknown): N3Snapshot | undefined {
  if (v === null || v === undefined) return emptySnapshot();
  if (!isObj(v)) return undefined;
  const id = textOrNull(v.id, 120);
  const code = textOrNull(v.code, 120);
  const name = textOrNull(v.name, 200);
  if (id === undefined || code === undefined || name === undefined) return undefined;
  // An identifier without its human-readable code cannot have come from a
  // selector row, so it is refused rather than stored.
  if (id !== null && code === null) return undefined;
  return { id, code, name };
}

export type PostingMappingsPatch = Partial<
  Record<
    PostingComponent,
    Partial<Pick<PostingMapping, "enabled" | "stock" | "uom" | "taxCode" | "resolvedAccount">>
  >
>;

export type PostingMappingsValidation =
  | { ok: true; patch: PostingMappingsPatch }
  | { ok: false; code: string };

/**
 * Validate an Owner patch. Deny by default: unknown components, unknown
 * fields and free-text identifiers without a code are all rejected. The
 * verification state is NEVER browser-supplied — the server owns it.
 */
export function validatePostingMappingsPatch(input: unknown): PostingMappingsValidation {
  if (!isObj(input)) return { ok: false, code: "invalid_posting_mappings" };
  const patch: PostingMappingsPatch = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!isPostingComponent(key)) return { ok: false, code: "invalid_posting_component" };
    if (!isObj(raw)) return { ok: false, code: "invalid_posting_mappings" };
    const next: PostingMappingsPatch[PostingComponent] = {};
    for (const field of Object.keys(raw)) {
      if (!["enabled", "stock", "uom", "taxCode", "resolvedAccount"].includes(field)) {
        return { ok: false, code: "invalid_posting_mapping_field" };
      }
    }
    if ("enabled" in raw) {
      if (typeof raw.enabled !== "boolean") return { ok: false, code: "invalid_posting_mappings" };
      next.enabled = raw.enabled;
    }
    for (const field of ["stock", "uom", "taxCode", "resolvedAccount"] as const) {
      if (!(field in raw)) continue;
      const snap = snapshot(raw[field]);
      if (!snap) return { ok: false, code: "invalid_posting_mapping_reference" };
      next[field] = snap;
    }
    patch[key] = next;
  }
  return { ok: true, patch };
}

/**
 * Apply a validated patch. Any change to a mapped reference resets the
 * verification state: a snapshot is only "verified" after the server has
 * re-read it from N3.
 */
export function applyPostingMappingsPatch(
  current: PostingMappings,
  patch: PostingMappingsPatch,
): PostingMappings {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch) as [
    PostingComponent,
    PostingMappingsPatch[PostingComponent],
  ][]) {
    if (!value) continue;
    const before = current[key] ?? defaultPostingMapping(key);
    const merged: PostingMapping = {
      ...before,
      enabled: value.enabled ?? before.enabled,
      stock: value.stock ?? before.stock,
      uom: value.uom ?? before.uom,
      taxCode: value.taxCode ?? before.taxCode,
      resolvedAccount: value.resolvedAccount ?? before.resolvedAccount,
    };
    const referencesChanged =
      merged.stock.id !== before.stock.id ||
      merged.uom.id !== before.uom.id ||
      merged.taxCode.id !== before.taxCode.id ||
      merged.resolvedAccount.id !== before.resolvedAccount.id;
    next[key] = referencesChanged
      ? { ...merged, verification: "unverified", verifiedAt: null }
      : merged;
  }
  return next;
}

/** Parse a persisted JSON payload back into the model. Never throws. */
export function parsePostingMappings(raw: unknown): PostingMappings {
  const out = defaultPostingMappings();
  if (!isObj(raw)) return out;
  for (const c of POSTING_COMPONENTS) {
    const v = raw[c];
    if (!isObj(v)) continue;
    const stock = snapshot(v.stock) ?? emptySnapshot();
    const uom = snapshot(v.uom) ?? emptySnapshot();
    const taxCode = snapshot(v.taxCode) ?? emptySnapshot();
    const resolvedAccount = snapshot(v.resolvedAccount) ?? emptySnapshot();
    const verification =
      v.verification === "verified" ||
      v.verification === "drifted" ||
      v.verification === "unavailable"
        ? (v.verification as MappingVerification)
        : "unverified";
    out[c] = {
      component: c,
      enabled: v.enabled === true,
      stock,
      uom,
      taxCode,
      resolvedAccount,
      verification,
      verifiedAt: typeof v.verifiedAt === "string" ? v.verifiedAt : null,
    };
  }
  return out;
}
