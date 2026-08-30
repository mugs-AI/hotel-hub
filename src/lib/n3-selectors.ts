// HH-GOLIVE-01A UAT correction — N3 read-only selector contract registry.
//
// Owner Settings must never ask a human to type an N3 UUID. Every N3 value is
// chosen from a searchable list that shows a human-readable code and name and
// keeps the immutable identifier server-side.
//
// A selector is only offered when HotelHub already has a PROVEN read-only N3
// contract in this repository. Nothing here guesses an endpoint: an unproven
// resource renders a disabled "N3 contract not yet verified" control and
// blocks readiness instead of inviting free-text identifiers.
//
// PURE module: no I/O, no secrets, safe in the browser bundle.

export const N3_SELECTOR_KINDS = ["stock", "gl_account", "tax_code", "uom"] as const;
export type N3SelectorKind = (typeof N3_SELECTOR_KINDS)[number];

export function isN3SelectorKind(v: unknown): v is N3SelectorKind {
  return typeof v === "string" && (N3_SELECTOR_KINDS as readonly string[]).includes(v);
}

export type N3SelectorContract = {
  kind: N3SelectorKind;
  /** Human label used in the Owner UI. Never an endpoint or an identifier. */
  label: string;
  /** True only when a read-only GET contract is proven in this repository. */
  proven: boolean;
  /**
   * The proven read-only endpoint, or `null` when unproven. Server-side use
   * only — the browser receives the label and the status, never this path.
   */
  endpoint: string | null;
  /** Where the proof comes from, for the audit trail. */
  evidence: string;
  /** What is still missing when `proven` is false. Shown to the Owner. */
  missingEvidence: string | null;
  /**
   * True when the list is only meaningful inside the context of an already
   * chosen N3 Stock. The browser control stays disabled until a Stock is
   * selected and the server refuses to load the list without that context.
   */
  requiresStockContext?: boolean;
};


export const N3_SELECTOR_CONTRACTS: Record<N3SelectorKind, N3SelectorContract> = {
  stock: {
    kind: "stock",
    label: "N3 stock / service code",
    proven: true,
    endpoint: "/api/stocks/list",
    evidence: "Live tenant list already used by Rooms & Rates and the charge catalogue.",
    missingEvidence: null,
  },
  gl_account: {
    kind: "gl_account",
    label: "N3 posting account",
    proven: true,
    endpoint: "/api/AccountCodes/Leaf/Query",
    evidence: "Read-only GL lookup already exercised by the N3 Financial Verification console.",
    missingEvidence: null,
  },
  tax_code: {
    kind: "tax_code",
    label: "N3 tax code",
    proven: false,
    endpoint: null,
    evidence: "No read-only tax-code contract is proven in the development brief or in code.",
    missingEvidence:
      "A verified read-only N3 tax-code list endpoint and its response fields (code, description, taxable class, active flag).",
  },
  uom: {
    kind: "uom",
    label: "N3 unit of measure",
    proven: false,
    endpoint: null,
    evidence:
      "No read-only unit-of-measure contract is proven in the development brief or in code.",
    missingEvidence:
      "A verified read-only N3 unit-of-measure list endpoint and its response fields (code, description, active flag).",
  },
};

export function isSelectorProven(kind: N3SelectorKind): boolean {
  return N3_SELECTOR_CONTRACTS[kind].proven;
}

/** One selectable N3 row. The browser only ever sees these three fields. */
export type N3SelectorRow = {
  /** Immutable N3 identifier. Opaque to the human, never typed by hand. */
  id: string;
  /** Human-readable code shown in the list. */
  code: string;
  /** Human-readable name/description. */
  name: string | null;
};

export type N3SelectorLoad =
  | { status: "ok"; kind: N3SelectorKind; items: N3SelectorRow[]; total: number }
  | { status: "contract_unverified"; kind: N3SelectorKind; missingEvidence: string }
  | { status: "unavailable"; kind: N3SelectorKind };

/** Standard blocked-state copy. Never mentions an endpoint or an identifier. */
export const SELECTOR_UNVERIFIED_TEXT = "N3 contract not yet verified";

/**
 * Free-text N3 identifiers are forbidden. A stored identifier is only valid
 * when it came from a selector row that the server itself loaded.
 */
export function isSelectionFromLoadedRows(
  rows: readonly N3SelectorRow[],
  id: string | null,
): boolean {
  if (!id) return false;
  return rows.some((r) => r.id === id);
}
