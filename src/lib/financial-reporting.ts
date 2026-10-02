// Monthly financial reporting — pure, browser-safe contracts.
// Property-local months, exact metric definitions and checked-cent aggregation.
// An unavailable or partial source is never shown as a complete zero, and
// different currencies are never summed.

export type FinancialMonth = {
  month: string;
  startDate: string;
  endExclusive: string;
  timezone: string;
};

export type FinancialSourceStatus = "complete" | "unavailable" | "needs_review";

export type FinancialSource<T> = {
  status: FinancialSourceStatus;
  rows: readonly T[];
  verifiedAt: string | null;
  reasonCode: string | null;
};

export type ReceiptRowStatus = "active" | "corrected" | "voided" | "needs_review";

export type HotelFinancialEvent = {
  transactionId: string;
  documentId: string;
  documentCode: string;
  documentDate: string;
  bookingReference: string;
  customerLabel: string;
  currency: string;
  amountCents: number;
  creationAmountCents: number;
  kind: "deposit" | "settlement" | "direct_payment" | "sale" | "void";
  state: "active" | "voided";
  receiptStatus: ReceiptRowStatus;
  savedPaymentName: string | null;
  paymentAccountId: string | null;
  accountCode: string | null;
  replacementOf: string | null;
  replacementReceiptId: string | null;
  requesterLabel: string | null;
  approverLabel: string | null;
  reason: string | null;
  confirmedVoidAt: string | null;
};

export type FinancialMetric = {
  amount: number | null;
  count: number | null;
  currency: string;
  status: FinancialSourceStatus;
  verifiedAt: string | null;
  explanation: string | null;
};

export type MonthlyFinancialDTO = {
  period: FinancialMonth;
  sales: FinancialMetric;
  deposits: FinancialMetric;
  collections: FinancialMetric;
  voids: FinancialMetric;
  currentVerifiedState: true;
};

export type ReceiptReportFilter = {
  month: string;
  tab: "receipts" | "voided";
  fromDate?: string;
  toDate?: string;
  bookingReference?: string;
  receiptNumber?: string;
  paymentAccountId?: string;
  status?: ReceiptRowStatus;
  sort: "documentDate" | "documentCode";
  direction: "asc" | "desc";
  limit: 25 | 50 | 100;
  offset: number;
};

export type ReceiptReportRow = {
  id: string;
  receiptId: string;
  receiptNumber: string;
  documentDate: string;
  bookingReference: string;
  customerLabel: string;
  currency: string;
  amount: number;
  creationAmount: number;
  savedPaymentName: string | null;
  accountCode: string | null;
  status: ReceiptRowStatus;
  replacementOf: string | null;
  replacementReceiptId: string | null;
  requesterLabel: string | null;
  approverLabel: string | null;
  reason: string | null;
  confirmedVoidAt: string | null;
  /** The receipt's own N3 document date (a void row's month is its void event). */
  n3DocumentDate: string | null;
};

export type ReceiptReportDTO = {
  period: FinancialMonth;
  items: ReceiptReportRow[];
  total: number;
  sourceStatus: FinancialSourceStatus;
  verifiedAt: string | null;
};

export class FinancialReportError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const UNAVAILABLE_FINAL_BILLING = "final_billing_source_not_connected";
export const FINANCIAL_EXPLANATION: Record<string, string> = {
  [UNAVAILABLE_FINAL_BILLING]: "Unavailable — final billing source not connected.",
  source_incomplete: "Unavailable — not every record could be checked. Try again.",
  verification_cap: "Unavailable — too many receipts to check at once for this month.",
  verification_budget: "Unavailable — N3 checks took too long. Try again.",
  mixed_currency: "Needs review — more than one currency; amounts are not added together.",
  needs_review: "Needs review — at least one receipt is not confirmed in N3.",
  overflow: "Needs review — amount is too large to total safely.",
  missing_date: "Needs review — a receipt has no N3 document date.",
  receipt_controls_not_installed: "Shown from original receipts; no corrections recorded yet.",
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function validTimezone(tz: string): boolean {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Property-local calendar date (YYYY-MM-DD) for an instant. */
export function propertyLocalDate(instant: Date | string, timezone: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new FinancialReportError("invalid_instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Strict YYYY-MM in the property's timezone; start-inclusive, end-exclusive. */
export function financialMonth(
  month: string | undefined,
  timezone: string,
  now: Date = new Date(),
): FinancialMonth {
  if (!validTimezone(timezone)) throw new FinancialReportError("invalid_timezone");
  const value = month ?? propertyLocalDate(now, timezone).slice(0, 7);
  const m = MONTH_RE.exec(value);
  if (!m) throw new FinancialReportError("invalid_month");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 2000 || y > 2100) throw new FinancialReportError("invalid_month");
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  return {
    month: value,
    startDate: `${value}-01`,
    endExclusive: `${ny}-${String(nm).padStart(2, "0")}-01`,
    timezone,
  };
}

export const inMonth = (date: string, p: FinancialMonth) =>
  isRealDate(date) && date >= p.startDate && date < p.endExclusive;

/** Checked cent addition; null on overflow. */
function addCents(a: number, b: number): number | null {
  const s = a + b;
  return Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(s) ? s : null;
}

const toAmount = (cents: number) => Math.round(cents) / 100;

function worst(...statuses: FinancialSourceStatus[]): FinancialSourceStatus {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("needs_review")) return "needs_review";
  return "complete";
}

function earliest(...values: Array<string | null>): string | null {
  const v = values.filter((x): x is string => Boolean(x)).sort();
  return v[0] ?? null;
}

type Picked = { rows: HotelFinancialEvent[]; status: FinancialSourceStatus; reason: string | null };

function metric(
  picked: Picked,
  currency: string,
  verifiedAt: string | null,
  value: (e: HotelFinancialEvent) => number,
): FinancialMetric {
  if (picked.status === "unavailable")
    return {
      amount: null,
      count: null,
      currency,
      status: "unavailable",
      verifiedAt: null,
      explanation: FINANCIAL_EXPLANATION[picked.reason ?? "source_incomplete"] ?? null,
    };
  let total = 0;
  let status = picked.status;
  let reason = picked.reason;
  for (const e of picked.rows) {
    if (e.currency.toUpperCase() !== currency.toUpperCase()) {
      return {
        amount: null,
        count: picked.rows.length,
        currency,
        status: "needs_review",
        verifiedAt,
        explanation: FINANCIAL_EXPLANATION.mixed_currency!,
      };
    }
    const v = value(e);
    const next = Number.isSafeInteger(v) && v >= 0 ? addCents(total, v) : null;
    if (next === null)
      return {
        amount: null,
        count: picked.rows.length,
        currency,
        status: "needs_review",
        verifiedAt,
        explanation: FINANCIAL_EXPLANATION.overflow!,
      };
    total = next;
    if (e.receiptStatus === "needs_review" && status === "complete") {
      status = "needs_review";
      reason = "needs_review";
    }
  }
  return {
    amount: toAmount(total),
    count: picked.rows.length,
    currency,
    status,
    verifiedAt,
    explanation: status === "complete" ? null : (FINANCIAL_EXPLANATION[reason ?? ""] ?? null),
  };
}

function pick(
  source: FinancialSource<HotelFinancialEvent>,
  predicate: (e: HotelFinancialEvent) => boolean,
  dateOf: (e: HotelFinancialEvent) => string | null,
  period: FinancialMonth,
): Picked {
  if (source.status === "unavailable")
    return { rows: [], status: "unavailable", reason: source.reasonCode };
  const rows: HotelFinancialEvent[] = [];
  for (const e of source.rows) {
    if (!predicate(e)) continue;
    const date = dateOf(e);
    if (!date || !isRealDate(date)) {
      // A missing document date can never be replaced by a local timestamp.
      return { rows: [], status: "unavailable", reason: "missing_date" };
    }
    if (inMonth(date, period)) rows.push(e);
  }
  return { rows, status: source.status, reason: source.reasonCode };
}

/** Deduplicate money transactions by authoritative N3 transaction identity. */
function dedupe(rows: HotelFinancialEvent[]): HotelFinancialEvent[] {
  const seen = new Map<string, HotelFinancialEvent>();
  for (const r of rows) if (!seen.has(r.transactionId)) seen.set(r.transactionId, r);
  return [...seen.values()];
}

const MONEY_KINDS = new Set(["deposit", "settlement", "direct_payment"]);
const voidDate = (e: HotelFinancialEvent, tz: string) =>
  e.confirmedVoidAt ? propertyLocalDate(e.confirmedVoidAt, tz) : null;

export function summarizeFinancialMonth(
  period: FinancialMonth,
  sources: {
    receipts: FinancialSource<HotelFinancialEvent>;
    sales: FinancialSource<HotelFinancialEvent>;
    otherCollections: FinancialSource<HotelFinancialEvent>;
  },
  currency: string,
): MonthlyFinancialDTO {
  const { receipts, sales, otherCollections } = sources;
  const docDate = (e: HotelFinancialEvent) => e.documentDate || null;
  const activeMoney = (e: HotelFinancialEvent) => MONEY_KINDS.has(e.kind) && e.state === "active";

  const deposits = pick(
    receipts,
    (e) => e.kind === "deposit" && e.state === "active",
    docDate,
    period,
  );
  const voids = pick(
    receipts,
    (e) => e.kind === "void",
    (e) => voidDate(e, period.timezone),
    period,
  );
  const salesPicked = pick(
    sales,
    (e) => e.kind === "sale" && e.state === "active",
    docDate,
    period,
  );
  const depositMoney = pick(receipts, activeMoney, docDate, period);
  const otherMoney = pick(otherCollections, activeMoney, docDate, period);
  const collectionsStatus = worst(depositMoney.status, otherMoney.status);
  const collections: Picked =
    collectionsStatus === "unavailable"
      ? {
          rows: [],
          status: "unavailable",
          reason: depositMoney.status === "unavailable" ? depositMoney.reason : otherMoney.reason,
        }
      : {
          rows: dedupe([...depositMoney.rows, ...otherMoney.rows]),
          status: collectionsStatus,
          reason: depositMoney.reason ?? otherMoney.reason,
        };
  const amount = (e: HotelFinancialEvent) => e.amountCents;
  return {
    period,
    sales: metric(salesPicked, currency, sales.verifiedAt, amount),
    deposits: metric(deposits, currency, receipts.verifiedAt, amount),
    collections: metric(
      collections,
      currency,
      earliest(receipts.verifiedAt, otherCollections.verifiedAt),
      amount,
    ),
    voids: metric(voids, currency, receipts.verifiedAt, amount),
    currentVerifiedState: true,
  };
}

const FILTER_KEYS = new Set([
  "month",
  "tab",
  "fromDate",
  "toDate",
  "bookingReference",
  "receiptNumber",
  "paymentAccountId",
  "status",
  "sort",
  "direction",
  "limit",
  "offset",
]);
const STATUSES = new Set<ReceiptRowStatus>(["active", "corrected", "voided", "needs_review"]);

function text(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key);
  if (v === null || v.trim() === "") return undefined;
  const t = v.trim();
  if (t.length > 100) throw new FinancialReportError("invalid_filter");
  return t;
}

export function validateReceiptReportFilter(
  input: URLSearchParams,
  period: FinancialMonth,
): ReceiptReportFilter {
  for (const key of input.keys())
    if (!FILTER_KEYS.has(key)) throw new FinancialReportError("unknown_filter");
  for (const key of FILTER_KEYS)
    if (input.getAll(key).length > 1) throw new FinancialReportError("invalid_filter");
  const month = input.get("month");
  if (month !== null && month !== period.month) throw new FinancialReportError("invalid_month");
  const tab = input.get("tab") ?? "receipts";
  if (tab !== "receipts" && tab !== "voided") throw new FinancialReportError("invalid_filter");
  const sort = input.get("sort") ?? "documentDate";
  if (sort !== "documentDate" && sort !== "documentCode")
    throw new FinancialReportError("invalid_filter");
  const direction = input.get("direction") ?? "desc";
  if (direction !== "asc" && direction !== "desc") throw new FinancialReportError("invalid_filter");
  const limitRaw = input.get("limit") ?? "25";
  if (!["25", "50", "100"].includes(limitRaw)) throw new FinancialReportError("invalid_paging");
  const offsetRaw = input.get("offset") ?? "0";
  if (!/^\d{1,9}$/.test(offsetRaw)) throw new FinancialReportError("invalid_paging");
  const offset = Number(offsetRaw);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new FinancialReportError("invalid_paging");
  const fromDate = text(input, "fromDate");
  const toDate = text(input, "toDate");
  for (const d of [fromDate, toDate])
    if (d !== undefined && !inMonth(d, period))
      throw new FinancialReportError("invalid_date_range");
  if (fromDate && toDate && fromDate > toDate) throw new FinancialReportError("invalid_date_range");
  const status = text(input, "status");
  if (status !== undefined && !STATUSES.has(status as ReceiptRowStatus))
    throw new FinancialReportError("invalid_filter");
  const out: ReceiptReportFilter = {
    month: period.month,
    tab,
    sort,
    direction,
    limit: Number(limitRaw) as 25 | 50 | 100,
    offset,
  };
  if (fromDate) out.fromDate = fromDate;
  if (toDate) out.toDate = toDate;
  const br = text(input, "bookingReference");
  if (br) out.bookingReference = br;
  const rn = text(input, "receiptNumber");
  if (rn) out.receiptNumber = rn;
  const pa = text(input, "paymentAccountId");
  if (pa) out.paymentAccountId = pa;
  if (status) out.status = status as ReceiptRowStatus;
  return out;
}

export function reportFilterParams(f: ReceiptReportFilter): URLSearchParams {
  const p = new URLSearchParams();
  p.set("month", f.month);
  p.set("tab", f.tab);
  p.set("sort", f.sort);
  p.set("direction", f.direction);
  p.set("limit", String(f.limit));
  p.set("offset", String(f.offset));
  for (const k of [
    "fromDate",
    "toDate",
    "bookingReference",
    "receiptNumber",
    "paymentAccountId",
    "status",
  ] as const) {
    const v = f[k];
    if (v) p.set(k, v);
  }
  return p;
}

/** Report rows from the shared event snapshot. Filters before paging. */
export function selectReportRows(
  events: readonly HotelFinancialEvent[],
  filter: ReceiptReportFilter,
  period: FinancialMonth,
): ReceiptReportRow[] {
  const wanted = filter.tab === "voided" ? "void" : "deposit";
  const from = filter.fromDate ?? period.startDate;
  const toExcl = filter.toDate ? nextDay(filter.toDate) : period.endExclusive;
  const rows = events
    .filter((e) => e.kind === wanted)
    .map((e) => ({ e, date: wanted === "void" ? voidDate(e, period.timezone) : e.documentDate }))
    .filter(({ date }) => date !== null && isRealDate(date) && date >= from && date < toExcl)
    .filter(({ e }) => {
      const ci = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());
      if (filter.bookingReference && !ci(e.bookingReference, filter.bookingReference)) return false;
      if (filter.receiptNumber && !ci(e.documentCode, filter.receiptNumber)) return false;
      if (filter.paymentAccountId && e.paymentAccountId !== filter.paymentAccountId) return false;
      if (filter.status && e.receiptStatus !== filter.status) return false;
      return true;
    })
    .map(({ e, date }) => toRow(e, date!));
  const dir = filter.direction === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const k = filter.sort === "documentCode" ? "receiptNumber" : "documentDate";
    const c = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
    return c !== 0 ? c * dir : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return rows;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toRow(e: HotelFinancialEvent, date: string): ReceiptReportRow {
  return {
    id: e.transactionId,
    receiptId: e.documentId,
    receiptNumber: e.documentCode,
    documentDate: date,
    bookingReference: e.bookingReference,
    customerLabel: e.customerLabel,
    currency: e.currency,
    amount: toAmount(e.amountCents),
    creationAmount: toAmount(e.creationAmountCents),
    savedPaymentName: e.savedPaymentName,
    accountCode: e.accountCode,
    status: e.receiptStatus,
    replacementOf: e.replacementOf,
    replacementReceiptId: e.replacementReceiptId,
    requesterLabel: e.requesterLabel,
    approverLabel: e.approverLabel,
    reason: e.reason,
    confirmedVoidAt: e.confirmedVoidAt,
    n3DocumentDate: e.documentDate || null,
  };
}

export const RECEIPT_STATUS_LABEL: Record<ReceiptRowStatus, string> = {
  active: "Original",
  corrected: "Corrected",
  voided: "Voided",
  needs_review: "Needs review",
};
