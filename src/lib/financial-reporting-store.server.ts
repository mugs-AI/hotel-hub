/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Bounded, tenant-scoped monthly financial sources shared by the dashboard
// cards, receipt/void reports and CSV export. GET-only N3 reads; never posts,
// matches, refunds or modifies receipts. Contract:
// docs/HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md
import { computeReceiptOverlay, type ReceiptVersionRow } from "./effective-receipts";
import {
  FinancialReportError,
  financialMonth,
  propertyLocalDate,
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
import {
  discoverMonthReceipts,
  MonthListError,
  type N3MonthPage,
  type N3MonthRow,
} from "./n3-month-receipts.server";

export const FINANCIAL_LIMITS = {
  localPageSize: 500,
  localCap: 100_000,
  idChunk: 200,
  verifyConcurrency: 3,
  /** Per selected-month candidate set (not hotel lifetime). */
  verifyCap: 100,
  /** One shared deadline for every DB and N3 call of a monthly read. */
  totalBudgetMs: 40_000,
  /** PostgREST response ceiling: every query pages below it with an exact count. */
  dbPageSize: 500,
  cacheTtlMs: 30_000,
  cacheEntries: 50,
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

export type FinancialReportingDeps = {
  settings(tenantId: string): Promise<{ timezone: string; currency: string } | null>;
  /**
   * EVERY posted HotelHub-created deposit for the tenant (no creation-date
   * window: N3 may redate a receipt arbitrarily). Ordered by id, keyset paged.
   */
  depositPage(tenantId: string, afterId: string | null, limit: number): Promise<FinancialDeposit[]>;
  /** null when receipt controls are not installed. Must return ALL rows (paged + counted). */
  versions(tenantId: string, depositIds: string[]): Promise<ReceiptVersionRow[] | null>;
  unresolved(tenantId: string, depositIds: string[]): Promise<string[] | null>;
  requests(tenantId: string, ids: string[]): Promise<RequestAudit[]>;
  bookingRefs(tenantId: string, reservationIds: string[]): Promise<Map<string, string>>;
  userLabels(tenantId: string, keys: string[]): Promise<Map<string, string>>;
  revision(tenantId: string): Promise<string>;
  /** GET-only. The signal fires at the shared deadline; late results are discarded. */
  verifyReceipt(
    actor: ReceiptControlActor,
    depositId: string,
    signal?: AbortSignal,
  ): Promise<ReceiptSnapshot>;
  /**
   * GET-only documented ARReceipts/List page for [startDate, endExclusive)
   * ordered docDate desc,docCode desc. Throws MonthListError on failure.
   */
  listMonthReceipts(
    actor: ReceiptControlActor,
    range: { startDate: string; endExclusive: string },
    skip: number,
    top: number,
    signal?: AbortSignal,
  ): Promise<N3MonthPage>;
  /** Optional verified adapters; absent means Unavailable, never zero. */
  sales?: (
    actor: ReceiptControlActor,
    p: FinancialMonth,
  ) => Promise<FinancialSource<HotelFinancialEvent>>;
  otherCollections?: (
    actor: ReceiptControlActor,
    p: FinancialMonth,
  ) => Promise<FinancialSource<HotelFinancialEvent>>;
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

/** One deadline shared by every DB and N3 call; nothing outlives it. */
export class Deadline {
  readonly controller = new AbortController();
  constructor(
    private readonly clock: () => number,
    private readonly endsAt: number,
  ) {}
  remaining() {
    return this.endsAt - this.clock();
  }
  async run<T>(p: () => Promise<T>): Promise<T> {
    const left = this.remaining();
    if (left <= 0 || this.controller.signal.aborted) {
      this.controller.abort();
      throw new SourceIncomplete("time_budget");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expire = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.controller.abort();
        reject(new SourceIncomplete("time_budget"));
      }, left);
    });
    try {
      return await Promise.race([p(), expire]);
    } finally {
      clearTimeout(timer);
    }
  }
}

const sameLines = (
  a: ReadonlyArray<{ accountId: string; amountCents: number }>,
  b: ReadonlyArray<{ accountId: string; amountCents: number }>,
) => {
  const key = (l: { accountId: string; amountCents: number }) =>
    `${l.accountId.toLowerCase()}|${l.amountCents}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length > 0 && x.length === y.length && x.every((k, i) => k === y[i]);
};

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

async function chunked<T>(
  ids: string[],
  size: number,
  run: (c: string[]) => Promise<T[] | null>,
): Promise<T[] | null> {
  const out: T[] = [];
  for (const c of chunks(ids, size)) {
    const r = await run(c);
    if (r === null) return null;
    out.push(...r);
  }
  return out;
}

/** Bounded parallel GET verification under the shared deadline. */
async function verifyBounded(
  actor: ReceiptControlActor,
  ids: string[],
  deps: FinancialReportingDeps,
  deadline: Deadline,
): Promise<Map<string, ReceiptSnapshot | ReceiptControlError>> {
  const out = new Map<string, ReceiptSnapshot | ReceiptControlError>();
  let next = 0;
  let unauthorized = false;
  let expired = false;
  const worker = async () => {
    while (next < ids.length && !unauthorized && !expired) {
      const id = ids[next++]!;
      try {
        out.set(
          id,
          await deadline.run(() => deps.verifyReceipt(actor, id, deadline.controller.signal)),
        );
      } catch (err) {
        if (err instanceof SourceIncomplete) {
          expired = true;
          return;
        }
        const e =
          err instanceof ReceiptControlError
            ? err
            : new ReceiptControlError("n3_evidence_unavailable");
        if (e.code === "unauthorized") unauthorized = true;
        out.set(id, e);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FINANCIAL_LIMITS.verifyConcurrency, ids.length) }, worker),
  );
  if (unauthorized) throw new ReceiptControlError("unauthorized");
  if (expired || out.size < ids.length) throw new SourceIncomplete("verification_budget");
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
  shared?: Deadline,
): Promise<FinancialSource<HotelFinancialEvent>> {
  const deadline = shared ?? new Deadline(clock, clock() + FINANCIAL_LIMITS.totalBudgetMs);
  const tenantId = actor.tenantId;
  try {
    // 1. Every HotelHub-linked posted deposit (bounded keyset paging). No
    //    creation-date heuristic: the N3 document date decides the month.
    const all: FinancialDeposit[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await deadline.run(() =>
        deps.depositPage(tenantId, after, FINANCIAL_LIMITS.localPageSize),
      );
      all.push(...page);
      if (all.length > FINANCIAL_LIMITS.localCap) throw new SourceIncomplete("source_incomplete");
      if (page.length < FINANCIAL_LIMITS.localPageSize) break;
      after = page[page.length - 1]!.id;
    }
    const ids = all.map((d) => d.id);
    const versionsRaw = await chunked(ids, FINANCIAL_LIMITS.idChunk, (c) =>
      deadline.run(() => deps.versions(tenantId, c)),
    );
    const installed = versionsRaw !== null || ids.length === 0;
    const versions = versionsRaw ?? [];
    const unresolved =
      (await chunked(ids, FINANCIAL_LIMITS.idChunk, (c) =>
        deadline.run(() => deps.unresolved(tenantId, c)),
      )) ?? [];
    const overlay = computeReceiptOverlay(versions, new Set(unresolved));
    const byDeposit = new Map<string, ReceiptVersionRow[]>();
    for (const v of versions) {
      const l = byDeposit.get(v.depositId) ?? [];
      l.push(v);
      byDeposit.set(v.depositId, l);
    }
    for (const l of byDeposit.values()) l.sort((a, b) => a.versionNo - b.versionNo);

    // 2. Documented N3 month discovery (docDate ge start, lt endExclusive).
    //    Only narrows the candidate set; HotelHub ownership is the exact saved
    //    receipt id, never a shared customer/bank/prefix.
    const range = { startDate: period.startDate, endExclusive: period.endExclusive };
    const listed = await discoverMonthReceipts(range, (skip, top) =>
      deadline.run(() =>
        deps.listMonthReceipts(actor, range, skip, top, deadline.controller.signal),
      ),
    );
    const inMonth = (date: string | null | undefined) =>
      !!date && date.slice(0, 10) >= range.startDate && date.slice(0, 10) < range.endExclusive;
    const candidates = all.filter((d) => {
      if (listed.has(d.n3ReceiptId.toLowerCase())) return true;
      // Effective current / replacement receipts listed in the month, and
      // stored version or void events dated in the month.
      return (byDeposit.get(d.id) ?? []).some(
        (v) =>
          listed.has(v.receiptId.toLowerCase()) ||
          inMonth(v.documentDate) ||
          // Existing confirmed void events count in the property-local month
          // of their stored verification, independent of the N3 document
          // date. Only stored voided versions (written after proof) qualify;
          // isCancelled / timestamps alone never create one.
          (v.state === "voided" &&
            !!v.verifiedAt &&
            inMonth(propertyLocalDate(v.verifiedAt, period.timezone))),
      );
    });
    if (candidates.length > FINANCIAL_LIMITS.verifyCap)
      throw new SourceIncomplete("verification_cap");

    // 3. Live GET for EVERY candidate, including corrected/voided ones: stored
    //    versions are never trusted forever.
    const snaps = await verifyBounded(
      actor,
      candidates.map((d) => d.id),
      deps,
      deadline,
    );

    // 4. Audit labels.
    // Audit/user-label lookups only for the selected candidates' versions.
    const candidateIds = new Set(candidates.map((d) => d.id));
    const requestIds = [
      ...new Set(versions.filter((v) => candidateIds.has(v.depositId)).map((v) => v.requestId)),
    ];
    const audits = new Map(
      (await deadline.run(() => deps.requests(tenantId, requestIds))).map((r) => [r.id, r]),
    );
    const keys = [
      ...new Set(
        [...audits.values()]
          .flatMap((a) => [a.requestedBy, a.approvedBy])
          .filter(Boolean) as string[],
      ),
    ];
    const labels = await deadline.run(() => deps.userLabels(tenantId, keys));
    const label = (k: string | null) => (k ? (labels.get(k) ?? "Staff") : null);
    const refs = await deadline.run(() =>
      deps.bookingRefs(tenantId, [...new Set(candidates.map((d) => d.reservationId))]),
    );

    const rows: HotelFinancialEvent[] = [];
    let anyUnavailable = false;
    for (const d of candidates) {
      const listRow: N3MonthRow | undefined = listed.get(d.n3ReceiptId.toLowerCase());
      // The list is discovery only: a cancelled flag never confirms a void,
      // and a list row contradicting the saved receipt is held Needs review.
      const listDrift =
        !!listRow &&
        ((listRow.referenceNo !== null &&
          listRow.referenceNo.toUpperCase() !== d.n3ReferenceNo.toUpperCase()) ||
          (listRow.currencyCode !== null &&
            listRow.currencyCode.toUpperCase() !== d.currency.toUpperCase()));
      const o = overlay.get(d.id) ?? {
        confirmed: { state: "original" as const },
        needsReview: false,
      };
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

      const latest = list[list.length - 1];
      const c = o.confirmed;
      const live = snaps.get(d.id);
      if (
        !live ||
        (live instanceof ReceiptControlError && live.code === "n3_evidence_unavailable")
      ) {
        anyUnavailable = true;
        continue;
      }
      if (c.state === "voided") {
        const voidRow = [...list].reverse().find((v) => v.state === "voided");
        const ownActive = [...list]
          .reverse()
          .find((v) => v.state === "active" && v.replacementOf === null);
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
          receiptStatus:
            o.needsReview ||
            listDrift ||
            listRow?.isCancelled === false ||
            live instanceof ReceiptControlError ||
            live.documentState !== "voided"
              ? "needs_review"
              : "voided",
          replacementOf: null,
          replacementReceiptId: null,
          confirmedVoidAt: voidRow?.verifiedAt ?? null,
        });
      } else if (c.state === "active" && c.replacementOf) {
        // The replacement receipt cannot be re-read through the deposit's own
        // receipt id; stale evidence is Unavailable, never trusted.
        anyUnavailable = true;
        continue;
      } else if (c.state === "active") {
        // Latest effective version for this receipt (not the first): its audit applies.
        const v =
          [...list].reverse().find((x) => x.receiptId === c.receiptId && x.state === "active") ??
          latest;
        const liveOk =
          !(live instanceof ReceiptControlError) &&
          live.receiptId.toLowerCase() === c.receiptId.toLowerCase() &&
          live.documentState === "active" &&
          live.amountCents === c.amountCents &&
          live.currency.toUpperCase() === (v?.currency ?? d.currency).toUpperCase() &&
          live.journalExact === true &&
          sameLines(live.paymentLines, c.paymentLines);
        rows.push({
          ...base,
          ...auditFor(v?.requestId),
          transactionId: c.receiptId,
          documentId: c.receiptId,
          documentCode: c.docCode,
          documentDate: live instanceof ReceiptControlError ? "" : live.documentDate,
          currency: v?.currency ?? d.currency,
          amountCents: c.amountCents,
          kind: "deposit",
          state: "active",
          receiptStatus: o.needsReview || !liveOk || listDrift ? "needs_review" : "corrected",
          savedPaymentName:
            c.paymentLines.map((l) => l.savedName).join(" + ") || base.savedPaymentName,
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
        const s = live;
        if (s instanceof ReceiptControlError) {
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
          s.journalExact === true &&
          // Immutable creation payment lines: an external bank change at the
          // same amount is account drift, held Needs review.
          sameLines(
            s.paymentLines,
            d.paymentLines.map((l) => ({ accountId: l.id, amountCents: toCents(l.amount) ?? -1 })),
          );
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
          receiptStatus:
            exact && !o.needsReview && !listDrift && listRow?.isCancelled !== true
              ? "active"
              : "needs_review",
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
    if (err instanceof MonthListError) {
      if (err.reason === "unauthorized") throw new ReceiptControlError("unauthorized");
      return unavailable(err.reason);
    }
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
  shared?: Deadline,
): Promise<MonthlySources> {
  assertOwner(actor);
  const clock = deps.now ?? Date.now;
  const deadline = shared ?? new Deadline(clock, clock() + FINANCIAL_LIMITS.totalBudgetMs);
  let settings: { currency: string; timezone: string } | null;
  let revision: string;
  try {
    settings = currency
      ? { currency, timezone: period.timezone }
      : await deadline.run(() => deps.settings(actor.tenantId));
    if (!settings) throw new FinancialReportError("hotel_settings_missing");
    revision = await deadline.run(() => deps.revision(actor.tenantId));
  } catch (err) {
    if (!(err instanceof SourceIncomplete)) throw err;
    const u = unavailable(err.reason);
    return { period, currency: currency ?? "", receipts: u, sales: u, otherCollections: u };
  }
  const key = `${actor.tenantId}|${period.month}|${period.timezone}|${revision}`;
  const hit = cache.get(key);
  if (hit && clock() - hit.at <= FINANCIAL_LIMITS.cacheTtlMs) return hit.value;
  const adapter = async (
    fn: FinancialReportingDeps["sales"],
  ): Promise<FinancialSource<HotelFinancialEvent>> => {
    if (!fn) return unavailable(UNAVAILABLE_FINAL_BILLING);
    try {
      return await deadline.run(() => fn(actor, period));
    } catch {
      return unavailable("source_incomplete");
    }
  };
  const [receipts, sales, otherCollections] = await Promise.all([
    readReceiptEvents(actor, period, settings.currency, deps, clock, deadline),
    adapter(deps.sales),
    adapter(deps.otherCollections),
  ]);
  const value: MonthlySources = {
    period,
    currency: settings.currency,
    receipts,
    sales,
    otherCollections,
  };
  if (receipts.status !== "unavailable") {
    if (cache.size >= FINANCIAL_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: clock(), value });
  }
  return value;
}

/**
 * ONE deadline per request covers settings/period resolution and every DB/N3
 * lookup; a hanging settings read can no longer outlive the budget.
 */
async function periodFor(
  actor: ReceiptControlActor,
  month: string | undefined,
  deps: FinancialReportingDeps,
): Promise<{ period: FinancialMonth; currency: string; deadline: Deadline; timedOut: boolean }> {
  assertOwner(actor);
  const clock = deps.now ?? Date.now;
  const deadline = new Deadline(clock, clock() + FINANCIAL_LIMITS.totalBudgetMs);
  let settings: { timezone: string; currency: string } | null;
  try {
    settings = await deadline.run(() => deps.settings(actor.tenantId));
  } catch (err) {
    if (!(err instanceof SourceIncomplete)) throw err;
    // Late settings answers are discarded; the month is reported Unavailable.
    return { period: financialMonth(month, "UTC"), currency: "", deadline, timedOut: true };
  }
  if (!settings) throw new FinancialReportError("hotel_settings_missing");
  return {
    period: financialMonth(month, settings.timezone, new Date(clock())),
    currency: settings.currency,
    deadline,
    timedOut: false,
  };
}

async function sourcesFor(
  actor: ReceiptControlActor,
  month: string | undefined,
  deps: FinancialReportingDeps,
) {
  const p = await periodFor(actor, month, deps);
  if (p.timedOut) {
    const u = unavailable("time_budget");
    const sources: MonthlySources = {
      period: p.period,
      currency: "",
      receipts: u,
      sales: u,
      otherCollections: u,
    };
    return { ...p, sources };
  }
  const sources = await readMonthlyFinancialSources(actor, p.period, deps, p.currency, p.deadline);
  return { ...p, sources };
}

/**
 * Lean current-period metadata for the month selector: settings only (one
 * bounded read), no N3 or receipt lookups. Fails closed on timeout.
 */
export async function readCurrentFinancialPeriod(
  actor: ReceiptControlActor,
  deps: FinancialReportingDeps,
): Promise<{ month: string }> {
  const p = await periodFor(actor, undefined, deps);
  if (p.timedOut) throw new FinancialReportError("period_unavailable");
  return { month: p.period.month };
}

export async function readMonthlyFinancialDashboard(
  actor: ReceiptControlActor,
  month: string | undefined,
  deps: FinancialReportingDeps,
): Promise<MonthlyFinancialDTO> {
  const { period, currency, sources } = await sourcesFor(actor, month, deps);
  return summarizeFinancialMonth(period, sources, currency);
}

export async function readReceiptReportSnapshot(
  actor: ReceiptControlActor,
  params: URLSearchParams,
  deps: FinancialReportingDeps,
  validate: (p: URLSearchParams, period: FinancialMonth) => ReceiptReportFilter,
): Promise<{ filter: ReceiptReportFilter; sources: MonthlySources; rows: ReceiptReportRow[] }> {
  const raw = params.get("month") ?? undefined;
  const { period, sources } = await sourcesFor(actor, raw, deps);
  const filter = validate(params, period);
  const rows =
    sources.receipts.status === "unavailable"
      ? []
      : selectReportRows(sources.receipts.rows, filter, period);
  return { filter, sources, rows };
}

export async function readReceiptReport(
  actor: ReceiptControlActor,
  filter: ReceiptReportFilter,
  deps: FinancialReportingDeps,
): Promise<ReceiptReportDTO> {
  const { period, sources } = await sourcesFor(actor, filter.month, deps);
  const status = sources.receipts.status;
  const rows =
    status === "unavailable" ? [] : selectReportRows(sources.receipts.rows, filter, period);
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
  const lines =
    Array.isArray(r.payment_lines) && r.payment_lines.length
      ? r.payment_lines.map((l: any) => ({
          id: String(l.id),
          code: String(l.code ?? ""),
          name: String(l.name ?? l.code ?? ""),
          amount: Number(l.amount),
        }))
      : r.n3_account_id
        ? [
            {
              id: r.n3_account_id,
              code: r.n3_account_code ?? "",
              name: r.n3_account_name ?? r.n3_account_code ?? "",
              amount: Number(r.amount),
            },
          ]
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

/**
 * Stable-order range paging with an exact count. Returns null when the table is
 * not installed; throws SourceIncomplete if pages and count disagree.
 */
export async function pagedAll(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: any[] | null; error: any; count: number | null }>,
  size: number = FINANCIAL_LIMITS.dbPageSize,
  cap: number = FINANCIAL_LIMITS.localCap,
): Promise<any[] | null> {
  const out: any[] = [];
  let total: number | null = null;
  for (let from = 0; ; from += size) {
    const res = await page(from, from + size - 1);
    if (res.error) {
      if (MISSING.has(res.error.code)) return null;
      fail(res);
    }
    if (typeof res.count !== "number") throw new SourceIncomplete("source_incomplete");
    if (total === null) total = res.count;
    else if (res.count !== total) throw new SourceIncomplete("source_incomplete"); // moved underneath us
    if (total > cap) throw new SourceIncomplete("source_incomplete");
    const data = res.data ?? [];
    out.push(...data);
    if (out.length >= total || data.length === 0) break;
  }
  if (out.length !== total) throw new SourceIncomplete("source_incomplete");
  return out;
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
    async depositPage(tenantId, afterId, limit) {
      let q = (await admin())
        .from("hotel_reservation_deposits")
        .select(DEPOSIT_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "posted")
        .not("n3_receipt_id", "is", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const res = await q;
      if (res.error) fail(res);
      return (res.data ?? []).map(toDeposit);
    },
    async versions(tenantId, ids) {
      const sb = await admin();
      const rows = await pagedAll((from, to) =>
        sb
          .from("hotel_receipt_versions")
          .select(
            "id, deposit_id, request_id, version_no, state, receipt_id, doc_code, document_date, currency, amount_cents, payment_lines, replacement_of, verified_at",
            { count: "exact" },
          )
          .eq("tenant_id", tenantId)
          .in("deposit_id", ids)
          .order("deposit_id", { ascending: true })
          .order("version_no", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      return rows === null ? null : rows.map(versionRow);
    },
    async unresolved(tenantId, ids) {
      const sb = await admin();
      const rows = await pagedAll((from, to) =>
        sb
          .from("hotel_receipt_control_requests")
          .select("id, deposit_id", { count: "exact" })
          .eq("tenant_id", tenantId)
          .in("deposit_id", ids)
          .in("state", ["applying", "failed", "needs_review"])
          .order("id", { ascending: true })
          .range(from, to),
      );
      return rows === null ? null : rows.map((r: any) => r.deposit_id as string);
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
          out.push({
            id: r.id,
            requestedBy: r.requested_by_n3_user_key ?? null,
            approvedBy: r.approved_by_n3_user_key ?? null,
            reason: r.reason ?? null,
          });
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
        const res = await sb
          .from(table)
          .select(col)
          .eq("tenant_id", tenantId)
          .order(col, { ascending: false })
          .limit(1);
        parts.push(
          res.error
            ? MISSING.has(res.error.code)
              ? "-"
              : `err${Date.now()}`
            : String(res.data?.[0]?.[col] ?? "0"),
        );
      }
      const { readChangeRevision, appendChangeRevision } =
        await import("./hotel-change-revision.server");
      try {
        return appendChangeRevision(parts.join("|"), await readChangeRevision(tenantId));
      } catch {
        throw new SourceIncomplete("source_incomplete");
      }
    },
    async listMonthReceipts(actor, range, skip, top, signal) {
      if (signal?.aborted) throw new MonthListError("n3_month_list_unavailable");
      const { n3Receipts } = await import("./n3-receipts.server");
      const { parseMonthPage } = await import("./n3-month-receipts.server");
      if (!n3Receipts.listByDocDate) throw new MonthListError("n3_month_list_unavailable");
      return parseMonthPage(await n3Receipts.listByDocDate(actor.n3Token, { ...range, skip, top }));
    },
    async verifyReceipt(actor, depositId, signal) {
      if (signal?.aborted) throw new ReceiptControlError("n3_evidence_unavailable");
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
