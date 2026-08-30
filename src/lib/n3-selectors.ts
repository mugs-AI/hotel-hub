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
    label: "N3 output tax code",
    proven: true,
    endpoint: "/api/TaxCodes/OutputTax/Query",
    evidence:
      "Official N3 read-only Output Tax code query with bounded OData pagination; TaxCodeDto exposes id, code, description, rate, isOutputTax and isActive.",
    missingEvidence: null,
  },
  uom: {
    kind: "uom",
    label: "N3 unit of measure",
    proven: true,
    endpoint: "/api/UOMs/Query",
    evidence:
      "Official N3 read-only unit-of-measure query with bounded OData pagination; UOMDto exposes id, code, description, isActive and stockId.",
    missingEvidence: null,
    // A UOM in N3 belongs to exactly one Stock, so the list is only
    // meaningful — and only loadable — once a Stock has been chosen.
    requiresStockContext: true,
  },
};

export function isSelectorProven(kind: N3SelectorKind): boolean {
  return N3_SELECTOR_CONTRACTS[kind].proven;
}

/** True when this selector cannot be loaded without a chosen N3 Stock. */
export function selectorRequiresStock(kind: N3SelectorKind): boolean {
  return N3_SELECTOR_CONTRACTS[kind].requiresStockContext === true;
}

/** Context a selector load may need. Currently only the stock-linked UOM list. */
export type N3SelectorContext = { stockId?: string | null };

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
  | { status: "stock_context_required"; kind: N3SelectorKind }
  | { status: "unavailable"; kind: N3SelectorKind };

/** Standard blocked-state copy. Never mentions an endpoint or an identifier. */
export const SELECTOR_UNVERIFIED_TEXT = "N3 contract not yet verified";

/** Shown when a unit of measure is requested before a Stock has been chosen. */
export const SELECTOR_STOCK_REQUIRED_TEXT =
  "Choose the N3 stock first — units of measure belong to a stock";

/** Maximum accepted length of any submitted N3 identifier. */
export const MAX_N3_ID_LENGTH = 120;

/**
 * Bounded shape check for an N3 identifier arriving from a browser. Returns
 * the trimmed identifier, `null` for an accepted clear, or `undefined` when
 * the value is malformed and must fail closed.
 */
export function boundedN3Id(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  if (v.length > MAX_N3_ID_LENGTH) return undefined;
  const t = v.trim();
  return t ? t : null;
}

/** Case- and whitespace-insensitive comparison of two N3 identifiers. */
export function sameN3Id(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

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
