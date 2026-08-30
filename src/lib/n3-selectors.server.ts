// HH-GOLIVE-01A UAT correction — server-only N3 selector loading.
//
// READ-ONLY. Only authenticated GETs already proven in this repository are
// ever issued. Unproven resources are refused locally: HotelHub never probes a
// guessed endpoint to "see if it works".
//
// The N3 bearer token never leaves the server, and raw upstream bodies are
// never returned to the browser — only `{ id, code, name }` triples.
import { callN3Path, listAllN3Stocks, N3ListError } from "./n3-gateway.server";
import { unwrapN3Array } from "./n3-owner";
import {
  N3_SELECTOR_CONTRACTS,
  type N3SelectorKind,
  type N3SelectorLoad,
  type N3SelectorRow,
} from "./n3-selectors";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pick(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function bool(row: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "yes") return true;
      if (t === "false" || t === "0" || t === "no") return false;
    }
    if (typeof v === "number") return v !== 0;
  }
  return null;
}

const ID_KEYS = ["id", "Id", "ID", "guid", "Guid", "key", "Key", "accountId", "AccountId"];
const CODE_KEYS = ["code", "Code", "accountCode", "AccountCode", "number", "Number"];
const NAME_KEYS = [
  "description",
  "Description",
  "name",
  "Name",
  "accountName",
  "AccountName",
  "displayName",
  "DisplayName",
];
const ACTIVE_KEYS = ["active", "Active", "isActive", "IsActive", "enabled", "Enabled"];
const POSTING_KEYS = [
  "isPostingAccount",
  "IsPostingAccount",
  "posting",
  "Posting",
  "isLeaf",
  "IsLeaf",
  "leaf",
  "Leaf",
  "isDetail",
  "IsDetail",
];
const SPECIAL_KEYS = ["SpecialType", "specialType", "SpecialAccountType"];

export type RoundingGlEligibility = "eligible" | "ineligible";

export type RoundingGlDecision = {
  eligibility: RoundingGlEligibility;
  reasons: string[];
};

/**
 * Strict, fail-closed eligibility for a ROUNDING posting account.
 *
 * Deliberately distinct from the bank/cash classification used by the
 * Financial Verification console: money settlement accounts are exactly what a
 * rounding difference must NOT be posted to. Requirements:
 *   * an immutable identifier and a human-readable code;
 *   * an explicit active flag that is true;
 *   * an explicit posting/leaf flag that is true;
 *   * not flagged as a bank or cash special account.
 * A missing flag is never assumed — it is ineligible.
 */
export function evaluateRoundingGlAccount(row: unknown): RoundingGlDecision {
  if (!isObj(row)) return { eligibility: "ineligible", reasons: ["row_not_object"] };
  const reasons: string[] = [];
  if (!pick(row, ID_KEYS)) reasons.push("missing_immutable_id");
  if (!pick(row, CODE_KEYS)) reasons.push("missing_account_code");
  const active = bool(row, ACTIVE_KEYS);
  if (active === null) reasons.push("missing_active_flag");
  else if (!active) reasons.push("account_inactive");
  const posting = bool(row, POSTING_KEYS);
  if (posting === null) reasons.push("missing_posting_or_leaf_flag");
  else if (!posting) reasons.push("account_not_posting");
  const special = (pick(row, SPECIAL_KEYS) ?? "").toLowerCase();
  if (special.includes("bank") || special.includes("cash")) {
    reasons.push("settlement_account_not_eligible_for_rounding");
  }
  return reasons.length === 0
    ? { eligibility: "eligible", reasons: ["active", "posting", "not_settlement"] }
    : { eligibility: "ineligible", reasons };
}

function toSelectorRow(row: unknown): N3SelectorRow | null {
  if (!isObj(row)) return null;
  const id = pick(row, ID_KEYS);
  const code = pick(row, CODE_KEYS);
  if (!id || !code) return null;
  return { id, code, name: pick(row, NAME_KEYS) };
}

export class N3SelectorUnauthorized extends Error {
  constructor() {
    super("n3_unauthorized");
    this.name = "N3SelectorUnauthorized";
  }
}

/**
 * Load the full selectable list for one selector kind.
 *
 * Never throws for an unproven contract — it returns `contract_unverified` so
 * the Owner sees a disabled control with a truthful explanation.
 */
export async function loadN3Selector(token: string, kind: N3SelectorKind): Promise<N3SelectorLoad> {
  const contract = N3_SELECTOR_CONTRACTS[kind];
  if (!contract.proven || !contract.endpoint) {
    return {
      status: "contract_unverified",
      kind,
      missingEvidence: contract.missingEvidence ?? "No proven read-only N3 contract.",
    };
  }

  if (kind === "stock") {
    try {
      const { items, total } = await listAllN3Stocks(token);
      const rows: N3SelectorRow[] = items
        .filter((s) => s.isActive !== false)
        .map((s) => ({ id: s.id, code: s.code, name: s.name ?? null }));
      return { status: "ok", kind, items: rows, total: rows.length || total };
    } catch (e) {
      if (e instanceof N3ListError && e.code === "unauthorized") throw new N3SelectorUnauthorized();
      return { status: "unavailable", kind };
    }
  }

  // gl_account — proven read-only GL lookup, eligible rounding accounts only.
  let res: { status: number; body: unknown };
  try {
    res = await callN3Path(token, contract.endpoint);
  } catch {
    return { status: "unavailable", kind };
  }
  if (res.status === 401 || res.status === 403) throw new N3SelectorUnauthorized();
  if (res.status < 200 || res.status >= 300) return { status: "unavailable", kind };
  const unwrapped = unwrapN3Array(res.body);
  if (unwrapped.status !== "ok") return { status: "unavailable", kind };

  const rows: N3SelectorRow[] = [];
  for (const raw of unwrapped.items) {
    if (evaluateRoundingGlAccount(raw).eligibility !== "eligible") continue;
    const row = toSelectorRow(raw);
    if (row) rows.push(row);
  }
  return { status: "ok", kind, items: rows, total: rows.length };
}
