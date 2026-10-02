/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Bounded, tenant-scoped monthly financial sources shared by the dashboard
// cards, receipt/void reports and CSV export. GET-only N3 reads; never posts,
// matches, refunds or modifies receipts. Contract:
// docs/HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md
import { computeReceiptOverlay, type ReceiptVersionRow } from "./effective-receipts";
import {
  FinancialReportError,
  financialMonth,
  selectReportRows,
  summarizeFinancialMonth,
  UNAVAILABLE_FINAL_BILLING,
  type FinancialMonth,
  type FinancialSource,
  type HotelFinancialEvent,
  type MonthlyFinancialDTO,
  type ReceiptReportDTO,
  type ReceiptReportFilter,
  type ReceiptReportRow,
} from "./financial-reporting";
import { ReceiptControlError, type ReceiptSnapshot } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";

export const FINANCIAL_LIMITS = {
  localPageSize: 500,
  localCap: 100_000,
  idChunk: 200,
  verifyConcurrency: 3,
  verifyCap: 100,
  verifyBudgetMs: 20_000,
  totalBudgetMs: 40_000,
  cacheTtlMs: 30_000,
  cacheEntries: 50,
  /** Days around the month used to find candidate receipts by creation time. */
  candidateWindowDays: 2,
} as const;

export type FinancialDeposit = {
  id: string;
  reservationId: string;
  n3ReceiptId: string;
  n3DocCode: string | null;
  n3ReferenceNo: string;
  customerLabel: string;
  currency: string;
  amountCents: number;
  paymentLines: Array<{ id: string; code: string; name: string; amount: number }>;
  createdAt: string;
};

export type RequestAudit = {
  id: string;
  requestedBy: string | null;
  approvedBy: string | null;
  reason: string | null;
};

type Window = { fromIso: string; toIso: string };

export type FinancialReportingDeps = {
  settings(tenantId: string): Promise<{ timezone: string; currency: string } | null>;
  /** Posted, HotelHub-created deposits only (immutable reference + receipt id). Ordered by id. */
  depositPage(tenantId: string, w: Window, afterId: string | null, limit: number): Promise<FinancialDeposit[]>;
  depositsByIds(tenantId: string, ids: string[]): Promise<FinancialDeposit[]>;
  /** null when receipt controls are not installed. */
  voidedDepositIds(tenantId: string, w: Window): Promise<string[] | null>;
  versions(tenantId: string, depositIds: string[]): Promise<ReceiptVersionRow[] | null>;
  unresolved(tenantId: string, depositIds: string[]): Promise<string[] | null>;
  requests(tenantId: string, ids: string[]): Promise<RequestAudit[]>;
  bookingRefs(tenantId: string, reservationIds: string[]): Promise<Map<string, string>>;
  userLabels(tenantId: string, keys: string[]): Promise<Map<string, string>>;
  revision(tenantId: string): Promise<string>;
  verifyReceipt(actor: ReceiptControlActor, depositId: string): Promise<ReceiptSnapshot>;
  /** Optional verified adapters; absent means Unavailable, never zero. */
  sales?: (actor: ReceiptControlActor, p: FinancialMonth) => Promise<FinancialSource<HotelFinancialEvent>>;
  otherCollections?: (actor: ReceiptControlActor, p: FinancialMonth) => Promise<FinancialSource<HotelFinancialEvent>>;
  now?: () => number;
  sleepless?: boolean;
};

export type MonthlySources = {
  period: FinancialMonth;
  currency: string;
  receipts: FinancialSource<HotelFinancialEvent>;
  sales: FinancialSource<HotelFinancialEvent>;
  otherCollections: FinancialSource<HotelFinancialEvent>;
};

class SourceIncomplete extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

function assertOwner(actor: ReceiptControlActor) {
  if (!actor?.tenantId || actor.role !== "owner") throw new FinancialReportError("forbidden");
}

const toCents = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) ? c : null;
};

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

const unavailable = (reasonCode: string): FinancialSource<HotelFinancialEvent> => ({
  status: "unavailable",
  rows: [],
  verifiedAt: null,
  reasonCode,
});

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function chunked<T>(ids: string[], size: number, run: (c: string[]) => Promise<T[] | null>): Promise<T[] | null> {
  const out: T[] = [];
  for (const c of chunks(ids, size)) {
    const r = await run(c);
    if (r === null) return null;
    out.push(...r);
  }
  return out;
}

/** Bounded parallel GET verification. Stops STARTING reads after the budget. */
async function verifyBounded(
  actor: ReceiptControlActor,
  ids: string[],
  deps: FinancialReportingDeps,
  clock: () => number,
): Promise<Map<string, ReceiptSnapshot | ReceiptControlError>> {
  const started = clock();
  const out = new Map<string, ReceiptSnapshot | ReceiptControlError>();
  let next = 0;
  let budgetHit = false;
  let unauthorized = false;
  const worker = async () => {
    while (next < ids.length && !unauthorized) {
      if (clock() - started > FINANCIAL_LIMITS.verifyBudgetMs) {
        budgetHit = true;
        return;
      }
      const id = ids[next++]!;
      try {
        out.set(id, await deps.verifyReceipt(actor, id));
      } catch (err) {
        const e = err instanceof ReceiptControlError ? err : new ReceiptControlError("n3_evidence_unavailable");
        if (e.code === "unauthorized") unauthorized = true;
        out.set(id, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FINANCIAL_LIMITS.verifyConcurrency, ids.length) }, worker));
  if (unauthorized) throw new ReceiptControlError("unauthorized");
  if (budgetHit || out.size < ids.length) throw new SourceIncomplete("verification_budget");
  return out;
}

const lineOf = (d: FinancialDeposit) => d.paymentLines[0] ?? null;
const lineNames = (d: FinancialDeposit) =>
  d.paymentLines.length ? d.paymentLines.map((l) => l.name).join(" + ") : null;

/** Build HotelHub-linked receipt events from the repaired effective projection. */
export async function readReceiptEvents(
  actor: ReceiptControlActor,
  period: FinancialMonth,
  currency: string,
  deps: FinancialReportingDeps,
  clock: () => number,
): Promise<FinancialSource<HotelFinancialEvent>> {
  const t0 = clock();
  const overBudget = () => clock() - t0 > FINANCIAL_LIMITS.totalBudgetMs;
  const tenantId = actor.tenantId;
  const w: Window = {
    fromIso: shiftDays(period.startDate, -FINANCIAL_LIMITS.candidateWindowDays),
    toIso: shiftDays(period.endExclusive, FINANCIAL_LIMITS.candidateWindowDays),
  };
  try {
    // 1. Candidate HotelHub deposits, complete stable-id paging with a hard cap.
    const candidates: FinancialDeposit[] = [];
    let after: string | null = null;
    for (;;) {
      if (overBudget()) throw new SourceIncomplete("source_incomplete");
      const page = await deps.depositPage(tenantId, w, after, FINANCIAL_LIMITS.localPageSize);
      candidates.push(...page);
      if (candidates.length > FINANCIAL_LIMITS.localCap) throw new SourceIncomplete("source_incomplete");
      if (page.length < FINANCIAL_LIMITS.localPageSize) break;
      after = page[page.length - 1]!.id;
    }
    const inWindow = new Set(candidates.map((d) => d.id));
    // 2. Deposits whose void was confirmed around this month (may be older).
    const voidedIds = await deps.voidedDepositIds(tenantId, w);
    const installed = voidedIds !== null;
    const extra = (voidedIds ?? []).filter((id) => !inWindow.has(id));
    const all = [...candidates];
    if (extra.length) {
      const more = await chunked(extra, FINANCIAL_LIMITS.idChunk, (c) => deps.depositsByIds(tenantId, c));
      all.push(...(more ?? []));
    }
    const ids = all.map((d) => d.id);
    const versions = installed
      ? ((await chunked(ids, FINANCIAL_LIMITS.idChunk, (c) => deps.versions(tenantId, c))) ?? [])
      : [];
    const unresolved = installed
      ? ((await chunked(ids, FINANCIAL_LIMITS.idChunk, (c) => deps.unresolved(tenantId, c))) ?? [])
      : [];
    const overlay = computeReceiptOverlay(versions, new Set(unresolved));
    const byDeposit = new Map<string, ReceiptVersionRow[]>();
    for (const v of versions) {
      const l = byDeposit.get(v.depositId) ?? [];
      l.push(v);
      byDeposit.set(v.depositId, l);
    }
    for (const l of byDeposit.values()) l.sort((a, b) => a.versionNo - b.versionNo);

    // 3. Originals with no verified version need authoritative N3 dates/amounts.
    const needGet = candidates
      .filter((d) => (overlay.get(d.id)?.confirmed.state ?? "original") === "original")
      .map((d) => d.id);
    if (needGet.length > FINANCIAL_LIMITS.verifyCap) throw new SourceIncomplete("verification_cap");
    const snaps = await verifyBounded(actor, needGet, deps, clock);
    if (overBudget()) throw new SourceIncomplete("source_incomplete");

    // 4. Audit labels.
    const requestIds = [...new Set(versions.map((v) => v.requestId))];
    const audits = new Map((await deps.requests(tenantId, requestIds)).map((r) => [r.id, r]));
    const keys = [...new Set([...audits.values()].flatMap((a) => [a.requestedBy, a.approvedBy]).filter(Boolean) as string[])];
    const labels = await deps.userLabels(tenantId, keys);
    const label = (k: string | null) => (k ? (labels.get(k) ?? "Staff") : null);
    const refs = await deps.bookingRefs(tenantId, [...new Set(all.map((d) => d.reservationId))]);

    const rows: HotelFinancialEvent[] = [];
    let anyUnavailable = false;
    for (const d of all) {
      const o = overlay.get(d.id) ?? { confirmed: { state: "original" as const }, needsReview: false };
      const list = byDeposit.get(d.id) ?? [];
      const line = lineOf(d);
      const base = {
        bookingReference: refs.get(d.reservationId) ?? "",
        customerLabel: d.customerLabel,
        currency: d.currency,
        creationAmountCents: d.amountCents,
        savedPaymentName: lineNames(d),
        paymentAccountId: line?.id ?? null,
        accountCode: line?.code ?? null,
      };
      const auditFor = (requestId: string | undefined) => {
        const a = requestId ? audits.get(requestId) : undefined;
        return {
          requesterLabel: label(a?.requestedBy ?? null),
          approverLabel: label(a?.approvedBy ?? null),
          reason: a?.reason ?? null,
        };
      };

      // Void events: last confirmed effective amount immediately before each void.
      let current: number | null = d.amountCents;
      let currentReceipt = d.n3ReceiptId;
      let currentCode = d.n3DocCode ?? "";
      for (const v of list) {
        if (v.state === "active") {
          if (v.replacementOf !== null && current !== null) continue; // replacement without a confirmed void never counts
          current = v.amountCents;
          currentReceipt = v.receiptId;
          currentCode = v.docCode;
        } else if (current !== null) {
          rows.push({
            ...base,
            ...auditFor(v.requestId),
            transactionId: `void:${currentReceipt}:${v.versionNo}`,
            documentId: currentReceipt,
            documentCode: currentCode,
            documentDate: v.documentDate,
            currency: v.currency,
            amountCents: current,
            kind: "void",
            state: "active",
            receiptStatus: "voided",
            replacementOf: null,
            replacementReceiptId: null,
            confirmedVoidAt: v.verifiedAt,
          });
          current = null;
        }
      }
      if (!inWindow.has(d.id)) continue; // older receipt: only its void event belongs here

      const latest = list[list.length - 1];
      const c = o.confirmed;
      if (c.state === "voided") {
        const voidRow = [...list].reverse().find((v) => v.state === "voided");
        const ownActive = [...list].reverse().find((v) => v.state === "active" && v.replacementOf === null);
        rows.push({
          ...base,
          ...auditFor(voidRow?.requestId),
          transactionId: d.n3ReceiptId,
          documentId: d.n3ReceiptId,
          documentCode: d.n3DocCode ?? ownActive?.docCode ?? "",
          documentDate: (ownActive ?? voidRow)?.documentDate ?? "",
          amountCents: 0,
          kind: "deposit",
          state: "voided",
          receiptStatus: o.needsReview ? "needs_review" : "voided",
          replacementOf: null,
          replacementReceiptId: null,
          confirmedVoidAt: voidRow?.verifiedAt ?? null,
        });
      } else if (c.state === "active") {
        const v = list.find((x) => x.receiptId === c.receiptId && x.state === "active") ?? latest;
        rows.push({
          ...base,
          ...auditFor(v?.requestId),
          transactionId: c.receiptId,
          documentId: c.receiptId,
          documentCode: c.docCode,
          documentDate: v?.documentDate ?? "",
          currency: v?.currency ?? d.currency,
          amountCents: c.amountCents,
          kind: "deposit",
          state: "active",
          receiptStatus: o.needsReview ? "needs_review" : "corrected",
          savedPaymentName: c.paymentLines.map((l) => l.savedName).join(" + ") || base.savedPaymentName,
          paymentAccountId: c.paymentLines[0]?.accountId ?? base.paymentAccountId,
          accountCode: c.paymentLines[0]?.code ?? base.accountCode,
          replacementOf: c.replacementOf,
          replacementReceiptId: null,
          confirmedVoidAt: null,
        });
        // The original voided receipt also appears, linked to its replacement.
        if (c.replacementOf) {
          const voidRow = list.find((x) => x.state === "voided" && x.replacementOf === null);
          rows.push({
            ...base,
            ...auditFor(voidRow?.requestId),
            transactionId: d.n3ReceiptId,
            documentId: d.n3ReceiptId,
            documentCode: d.n3DocCode ?? "",
            documentDate: voidRow?.documentDate ?? "",
            amountCents: 0,
            kind: "deposit",
            state: "voided",
            receiptStatus: "voided",
            replacementOf: null,
            replacementReceiptId: c.receiptId,
            confirmedVoidAt: voidRow?.verifiedAt ?? null,
          });
        }
      } else {
        const s = snaps.get(d.id);
        if (!s) {
          anyUnavailable = true;
          continue;
        }
        if (s instanceof ReceiptControlError) {
          if (s.code === "n3_evidence_unavailable") {
            anyUnavailable = true;
            continue;
          }
          // External edit / mismatch: held, never dated from local creation time.
          rows.push({
            ...base,
            ...auditFor(latest?.requestId),
            transactionId: d.n3ReceiptId,
            documentId: d.n3ReceiptId,
            documentCode: d.n3DocCode ?? "",
            documentDate: "",
            amountCents: d.amountCents,
            kind: "deposit",
            state: "active",
            receiptStatus: "needs_review",
            replacementOf: null,
            replacementReceiptId: null,
            confirmedVoidAt: null,
          });
          continue;
        }
        const exact =
          s.documentState === "active" &&
          s.amountCents === d.amountCents &&
          s.currency.toUpperCase() === d.currency.toUpperCase() &&
          s.journalExact === true;
        rows.push({
          ...base,
          ...auditFor(latest?.requestId),
          transactionId: d.n3ReceiptId,
          documentId: d.n3ReceiptId,
          documentCode: s.docCode,
          documentDate: s.documentDate,
          amountCents: d.amountCents,
          kind: "deposit",
          state: "active",
          receiptStatus: exact && !o.needsReview ? "active" : "needs_review",
          replacementOf: null,
          replacementReceiptId: null,
          confirmedVoidAt: null,
        });
      }
    }
    if (anyUnavailable) return unavailable("source_incomplete");
    // Receipts outside the month after authoritative dating are dropped downstream.
    void currency;
    return {
      status: rows.some((r) => r.receiptStatus === "needs_review") ? "needs_review" : "complete",
      rows,
      verifiedAt: new Date(clock()).toISOString(),
      reasonCode: installed ? null : "receipt_controls_not_installed",
    };
  } catch (err) {
    if (err instanceof SourceIncomplete) return unavailable(err.reason);
    if (err instanceof ReceiptControlError && err.code === "unauthorized") throw err;
    if (err instanceof FinancialReportError) throw err;
    console.error("[financial-reporting] source failed", (err as Error).message?.slice(0, 200));
    return unavailable("source_incomplete");
  }
}

type CacheEntry = { at: number; value: MonthlySources };
const cache = new Map<string, CacheEntry>();
export function clearFinancialCache() {
  cache.clear();
}

export async function readMonthlyFinancialSources(
  actor: ReceiptControlActor,
  period: FinancialMonth,
  deps: FinancialReportingDeps,
  currency?: string,
): Promise<MonthlySources> {
  assertOwner(actor);
  const clock = deps.now ?? Date.now;
  const settings = currency ? { currency, timezone: period.timezone } : await deps.settings(actor.tenantId);
  if (!settings) throw new FinancialReportError("hotel_settings_missing");
  const revision = await deps.revision(actor.tenantId);
  const key = `${actor.tenantId}|${period.month}|${period.timezone}|${revision}`;
  const hit = cache.get(key);
  if (hit && clock() - hit.at <= FINANCIAL_LIMITS.cacheTtlMs) return hit.value;
  const adapter = async (
    fn: FinancialReportingDeps["sales"],
  ): Promise<FinancialSource<HotelFinancialEvent>> => {
    if (!fn) return unavailable(UNAVAILABLE_FINAL_BILLING);
    try {
      return await fn(actor, period);
    } catch {
      return unavailable("source_incomplete");
    }
  };
  const [receipts, sales, otherCollections] = await Promise.all([
    readReceiptEvents(actor, period, settings.currency, deps, clock),
    adapter(deps.sales),
    adapter(deps.otherCollections),
  ]);
  const value: MonthlySources = { period, currency: settings.currency, receipts, sales, otherCollections };
  if (receipts.status !== "unavailable") {
    if (cache.size >= FINANCIAL_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: clock(), value });
  }
  return value;
}

async function periodFor(actor: ReceiptControlActor, month: string | undefined, deps: FinancialReportingDeps) {
  assertOwner(actor);
  const settings = await deps.settings(actor.tenantId);
  if (!settings) throw new FinancialReportError("hotel_settings_missing");
  return { period: financialMonth(month, settings.timezone), currency: settings.currency };
}

export async function readMonthlyFinancialDashboard(
  actor: ReceiptControlActor,
  month: string | undefined,
  deps: FinancialReportingDeps,
): Promise<MonthlyFinancialDTO> {
  const { period, currency } = await periodFor(actor, month, deps);
  const s = await readMonthlyFinancialSources(actor, period, deps, currency);
  return summarizeFinancialMonth(period, s, currency);
}

export async function readReceiptReportSnapshot(
  actor: ReceiptControlActor,
  params: URLSearchParams,
  deps: FinancialReportingDeps,
  validate: (p: URLSearchParams, period: FinancialMonth) => ReceiptReportFilter,
): Promise<{ filter: ReceiptReportFilter; sources: MonthlySources; rows: ReceiptReportRow[] }> {
  const raw = params.get("month") ?? undefined;
  const { period, currency } = await periodFor(actor, raw, deps);
  const filter = validate(params, period);
  const sources = await readMonthlyFinancialSources(actor, period, deps, currency);
  const rows =
    sources.receipts.status === "unavailable" ? [] : selectReportRows(sources.receipts.rows, filter, period);
  return { filter, sources, rows };
}

export async function readReceiptReport(
  actor: ReceiptControlActor,
  filter: ReceiptReportFilter,
  deps: FinancialReportingDeps,
): Promise<ReceiptReportDTO> {
  const { period, currency } = await periodFor(actor, filter.month, deps);
  const sources = await readMonthlyFinancialSources(actor, period, deps, currency);
  const status = sources.receipts.status;
  const rows = status === "unavailable" ? [] : selectReportRows(sources.receipts.rows, filter, period);
  return {
    period,
    items: rows.slice(filter.offset, filter.offset + filter.limit),
    total: rows.length,
    sourceStatus: status,
    verifiedAt: sources.receipts.verifiedAt,
  };
}

// ---------------------------------------------------------------------------
// Production wiring (service role, every query tenant-scoped).

const MISSING = new Set(["42P01", "PGRST205", "PGRST202"]);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

const DEPOSIT_COLS =
  "id, reservation_id, n3_receipt_id, n3_doc_code, n3_reference_no, n3_customer_name, currency_code, amount, payment_lines, n3_account_id, n3_account_code, n3_account_name, created_at";

function toDeposit(r: any): FinancialDeposit {
  const cents = toCents(r.amount);
  if (cents === null || cents <= 0) throw new SourceIncomplete("source_incomplete");
  const lines = Array.isArray(r.payment_lines) && r.payment_lines.length
    ? r.payment_lines.map((l: any) => ({ id: String(l.id), code: String(l.code ?? ""), name: String(l.name ?? l.code ?? ""), amount: Number(l.amount) }))
    : r.n3_account_id
      ? [{ id: r.n3_account_id, code: r.n3_account_code ?? "", name: r.n3_account_name ?? r.n3_account_code ?? "", amount: Number(r.amount) }]
      : [];
  return {
    id: r.id,
    reservationId: r.reservation_id,
    n3ReceiptId: r.n3_receipt_id,
    n3DocCode: r.n3_doc_code ?? null,
    n3ReferenceNo: r.n3_reference_no,
    customerLabel: r.n3_customer_name ?? "",
    currency: String(r.currency_code ?? "").toUpperCase(),
    amountCents: cents,
    paymentLines: lines,
    createdAt: r.created_at,
  };
}

function versionRow(r: any): ReceiptVersionRow {
  return {
    depositId: r.deposit_id,
    requestId: r.request_id,
    versionNo: r.version_no,
    state: r.state,
    receiptId: r.receipt_id,
    docCode: r.doc_code,
    documentDate: r.document_date,
    currency: r.currency,
    amountCents: Number(r.amount_cents),
    paymentLines: r.payment_lines ?? [],
    replacementOf: r.replacement_of ?? null,
    verifiedAt: r.verified_at,
  };
}

function fail(res: { error: any }): never {
  throw new Error(`financial read failed ${res.error?.code ?? ""}`);
}

export function defaultFinancialReportingDeps(): FinancialReportingDeps {
  return {
    async settings(tenantId) {
      const { getHotelSettingsReadOnly } = await import("./hotel-store.server");
      const s = await getHotelSettingsReadOnly(tenantId);
      return s ? { timezone: s.timezone, currency: s.currency } : null;
    },
    async depositPage(tenantId, w, afterId, limit) {
      let q = (await admin())
        .from("hotel_reservation_deposits")
        .select(DEPOSIT_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "posted")
        .not("n3_receipt_id", "is", null)
        .gte("created_at", w.fromIso)
        .lt("created_at", w.toIso)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const res = await q;
      if (res.error) fail(res);
      return (res.data ?? []).map(toDeposit);
    },
    async depositsByIds(tenantId, ids) {
      const res = await (await admin())
        .from("hotel_reservation_deposits")
        .select(DEPOSIT_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "posted")
        .not("n3_receipt_id", "is", null)
        .in("id", ids);
      if (res.error) fail(res);
      return (res.data ?? []).map(toDeposit);
    },
    async voidedDepositIds(tenantId, w) {
      const res = await (await admin())
        .from("hotel_receipt_versions")
        .select("deposit_id")
        .eq("tenant_id", tenantId)
        .eq("state", "voided")
        .gte("verified_at", w.fromIso)
        .lt("verified_at", w.toIso)
        .limit(FINANCIAL_LIMITS.localCap + 1);
      if (res.error) {
        if (MISSING.has(res.error.code)) return null;
        fail(res);
      }
      if ((res.data ?? []).length > FINANCIAL_LIMITS.localCap) throw new SourceIncomplete("source_incomplete");
      return [...new Set((res.data ?? []).map((r: any) => r.deposit_id as string))];
    },
    async versions(tenantId, ids) {
      const res = await (await admin())
        .from("hotel_receipt_versions")
        .select("deposit_id, request_id, version_no, state, receipt_id, doc_code, document_date, currency, amount_cents, payment_lines, replacement_of, verified_at")
        .eq("tenant_id", tenantId)
        .in("deposit_id", ids);
      if (res.error) {
        if (MISSING.has(res.error.code)) return null;
        fail(res);
      }
      return (res.data ?? []).map(versionRow);
    },
    async unresolved(tenantId, ids) {
      const res = await (await admin())
        .from("hotel_receipt_control_requests")
        .select("deposit_id")
        .eq("tenant_id", tenantId)
        .in("deposit_id", ids)
        .in("state", ["applying", "failed", "needs_review"]);
      if (res.error) {
        if (MISSING.has(res.error.code)) return null;
        fail(res);
      }
      return (res.data ?? []).map((r: any) => r.deposit_id as string);
    },
    async requests(tenantId, ids) {
      if (!ids.length) return [];
      const out: RequestAudit[] = [];
      for (const c of chunks(ids, FINANCIAL_LIMITS.idChunk)) {
        const res = await (await admin())
          .from("hotel_receipt_control_requests")
          .select("id, requested_by_n3_user_key, approved_by_n3_user_key, reason")
          .eq("tenant_id", tenantId)
          .in("id", c);
        if (res.error) {
          if (MISSING.has(res.error.code)) return [];
          fail(res);
        }
        for (const r of res.data ?? [])
          out.push({ id: r.id, requestedBy: r.requested_by_n3_user_key ?? null, approvedBy: r.approved_by_n3_user_key ?? null, reason: r.reason ?? null });
      }
      return out;
    },
    async bookingRefs(tenantId, ids) {
      const map = new Map<string, string>();
      for (const c of chunks(ids, FINANCIAL_LIMITS.idChunk)) {
        const res = await (await admin())
          .from("hotel_reservations")
          .select("id, booking_reference")
          .eq("tenant_id", tenantId)
          .in("id", c);
        if (res.error) fail(res);
        for (const r of res.data ?? []) map.set(r.id, r.booking_reference);
      }
      return map;
    },
    async userLabels(tenantId, keys) {
      const map = new Map<string, string>();
      if (!keys.length) return map;
      const res = await (await admin())
        .from("hotel_user_directory")
        .select("n3_user_key, display_name")
        .eq("tenant_id", tenantId)
        .in("n3_user_key", keys);
      if (res.error) fail(res);
      for (const r of res.data ?? []) if (r.display_name) map.set(r.n3_user_key, r.display_name);
      return map;
    },
    async revision(tenantId) {
      const sb = await admin();
      const parts: string[] = [];
      for (const [table, col] of [
        ["hotel_receipt_versions", "verified_at"],
        ["hotel_receipt_control_requests", "updated_at"],
        ["hotel_reservation_deposits", "updated_at"],
      ] as const) {
        const res = await sb.from(table).select(col).eq("tenant_id", tenantId).order(col, { ascending: false }).limit(1);
        parts.push(res.error ? (MISSING.has(res.error.code) ? "-" : `err${Date.now()}`) : String(res.data?.[0]?.[col] ?? "0"));
      }
      return parts.join("|");
    },
    async verifyReceipt(actor, depositId) {
      const { readReceiptControlEvidence } = await import("./receipt-controls-evidence.server");
      const { n3Receipts } = await import("./n3-receipts.server");
      const { loadDeposit } = await import("./receipt-controls-deps.server");
      return readReceiptControlEvidence(actor, depositId, {
        loadDeposit,
        // GET-only: the type deliberately excludes create.
        n3: { getById: n3Receipts.getById, getGLPosting: n3Receipts.getGLPosting },
      });
    },
  };
}
