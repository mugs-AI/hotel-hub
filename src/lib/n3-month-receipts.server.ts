// GET-only month discovery over the documented sales-v1
// GET /api/ARReceipts/List ($filter docDate ge/lt, $orderby, $skip, $top;
// response data.value + data.count). Discovery only narrows which saved
// HotelHub receipts are re-read; it never decides ownership, amounts or
// cancellation. Every inconsistency fails closed (=> Unavailable).
import { successfulEnvelope, valuesFor } from "./deposits-store.server";
import { isRealN3Id, type N3Outcome } from "./n3-receipts.server";

export const MONTH_LIST_LIMITS = { top: 100, maxPages: 20 } as const;

export type N3MonthRow = {
  id: string;
  docDate: string; // YYYY-MM-DD
  docCode: string;
  referenceNo: string | null;
  isCancelled: boolean | null;
  customerCode: string | null;
  currencyCode: string | null;
};
export type N3MonthPage = { count: number; rows: N3MonthRow[] };

export class MonthListError extends Error {
  constructor(
    public reason:
      | "n3_month_list_unavailable"
      | "n3_month_list_malformed"
      | "n3_filter_ignored"
      | "n3_month_list_inconsistent"
      | "n3_month_list_cap"
      | "unauthorized",
  ) {
    super(reason);
  }
}

function single(o: unknown, key: string): { ok: boolean; v: unknown } {
  const vs = valuesFor(o, [key]);
  if (vs.some((v) => JSON.stringify(v) !== JSON.stringify(vs[0]))) return { ok: false, v: null };
  return { ok: true, v: vs.length ? vs[0] : undefined };
}
const str = (o: unknown, k: string): string | null | false => {
  const r = single(o, k);
  if (!r.ok) return false;
  if (r.v === undefined || r.v === null) return null;
  return typeof r.v === "string" ? r.v : false;
};

/** Strict parse of one list page. Throws MonthListError on anything ambiguous. */
export function parseMonthPage(outcome: N3Outcome): N3MonthPage {
  if (outcome.kind !== "response") throw new MonthListError("n3_month_list_unavailable");
  if (outcome.status === 401) throw new MonthListError("unauthorized");
  if (outcome.status < 200 || outcome.status >= 300)
    throw new MonthListError("n3_month_list_unavailable");
  const body = outcome.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || !successfulEnvelope(body))
    throw new MonthListError("n3_month_list_unavailable");
  const d = single(body, "data");
  if (!d.ok || !d.v || typeof d.v !== "object" || Array.isArray(d.v))
    throw new MonthListError("n3_month_list_malformed");
  const value = single(d.v, "value");
  const count = single(d.v, "count");
  if (!value.ok || !Array.isArray(value.v) || !count.ok)
    throw new MonthListError("n3_month_list_malformed");
  const n = count.v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    throw new MonthListError("n3_month_list_malformed");
  const rows = value.v.map((r): N3MonthRow => {
    if (!r || typeof r !== "object" || Array.isArray(r))
      throw new MonthListError("n3_month_list_malformed");
    const id = str(r, "id");
    const date = str(r, "docDate");
    const code = str(r, "docCode");
    const ref = str(r, "referenceNo");
    const cust = str(r, "customerCode");
    const cur = str(r, "currencyCode");
    const canc = single(r, "isCancelled");
    if (!id || !isRealN3Id(id) || !date || code === false || ref === false || cust === false || cur === false)
      throw new MonthListError("n3_month_list_malformed");
    const day = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
      throw new MonthListError("n3_month_list_malformed");
    if (!canc.ok || (canc.v !== undefined && canc.v !== null && typeof canc.v !== "boolean"))
      throw new MonthListError("n3_month_list_malformed");
    return {
      id: id.toLowerCase(),
      docDate: day,
      docCode: code ?? "",
      referenceNo: ref,
      isCancelled: typeof canc.v === "boolean" ? canc.v : null,
      customerCode: cust,
      currencyCode: cur,
    };
  });
  return { count: n, rows };
}

export type FetchMonthPage = (skip: number, top: number) => Promise<N3MonthPage>;

/**
 * Complete, stable, deduplicated month listing. Fails closed when the server
 * ignores the filter (out-of-range dates), ignores the order, changes count
 * between pages, repeats ids, truncates, or exceeds the page budget.
 */
export async function discoverMonthReceipts(
  range: { startDate: string; endExclusive: string },
  fetchPage: FetchMonthPage,
): Promise<Map<string, N3MonthRow>> {
  const { top, maxPages } = MONTH_LIST_LIMITS;
  const out = new Map<string, N3MonthRow>();
  let count: number | null = null;
  let prev: N3MonthRow | null = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new MonthListError("n3_month_list_cap");
    const res = await fetchPage(page * top, top);
    if (count === null) {
      count = res.count;
      if (count > top * maxPages) throw new MonthListError("n3_month_list_cap");
    } else if (res.count !== count) throw new MonthListError("n3_month_list_inconsistent");
    if (res.rows.length > top) throw new MonthListError("n3_month_list_inconsistent");
    for (const r of res.rows) {
      if (r.docDate < range.startDate || r.docDate >= range.endExclusive)
        throw new MonthListError("n3_filter_ignored");
      if (out.has(r.id)) throw new MonthListError("n3_month_list_inconsistent");
      if (prev && (r.docDate > prev.docDate || (r.docDate === prev.docDate && r.docCode > prev.docCode)))
        throw new MonthListError("n3_month_list_inconsistent");
      prev = r;
      out.set(r.id, r);
    }
    if (out.size === count) return out;
    if (out.size > count || res.rows.length < top) throw new MonthListError("n3_month_list_inconsistent");
  }
}
