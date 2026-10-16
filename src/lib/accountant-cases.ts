import { MAX_MONEY_CENTS } from "./checkout-money";
export type AccountantCaseKey = {
  reservationId: string;
  intentId: string;
  kind: "receipt_surplus" | "refund_review" | "n3_conflict" | "ota_receivable";
  documentIds: string[];
};
export type AccountantCaseObservation = {
  available: boolean;
  checkedAt: string;
  evidenceDigest: string | null;
  observedAmountCents: number | null;
  outcomeCode: string;
};
export type AccountantCaseEvent = {
  kind: "note" | "review" | "resolve" | "reopen" | "observe";
  reason: string;
  observation: AccountantCaseObservation | null;
  proofDigest: string | null;
};
export type AccountantCaseRow = {
  caseId: string;
  version: string;
  key: AccountantCaseKey;
  bookingReference: string;
  stayFrom: string;
  stayTo: string;
  documentReferences: Array<{ id: string; code: string; date: string }>;
  currency: string;
  firstSeen: string;
  lastChecked: string | null;
  status: "open" | "reviewed" | "resolved";
  observation: AccountantCaseObservation;
  nextAction: string;
  notes: string[];
};
export type AccountantCasePage = {
  rows: AccountantCaseRow[];
  asAt: string;
  generatedAt: string;
  complete: boolean;
  nextOffset: number | null;
};
export type AccountantStatement = { statementId: string; digest: string; page: AccountantCasePage };
export type AccountantCaseHistory = {
  tenantId: string;
  caseId: string;
  events: Array<{ at: string; row: AccountantCaseRow }>;
};
export type AccountantListInput = {
  asAt: string;
  status: "open" | "all";
  offset: number;
  limit: number;
};
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(s);
const hash = (s: unknown) => typeof s === "string" && /^[a-f\d]{64}$/.test(s);
function fail(code = "accountant_invalid_input"): never {
  throw new Error(code);
}
function time(s: string): number {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    fail();
  return Date.parse(s);
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
export function accountantCaseKey(key: AccountantCaseKey): AccountantCaseKey {
  if (
    !uuid(key.reservationId) ||
    !uuid(key.intentId) ||
    !["receipt_surplus", "refund_review", "n3_conflict", "ota_receivable"].includes(key.kind) ||
    !Array.isArray(key.documentIds) ||
    !key.documentIds.length ||
    key.documentIds.length > 100 ||
    key.documentIds.some((x) => !uuid(x))
  )
    fail();
  const documentIds = key.documentIds.map((x) => x.toLowerCase()).sort();
  if (new Set(documentIds).size !== documentIds.length) fail();
  return freeze({
    reservationId: key.reservationId.toLowerCase(),
    intentId: key.intentId.toLowerCase(),
    kind: key.kind,
    documentIds,
  });
}
export function validateAccountantObservation(o: AccountantCaseObservation): void {
  time(o.checkedAt);
  if (
    typeof o.available !== "boolean" ||
    typeof o.outcomeCode !== "string" ||
    !/^[a-zA-Z0-9_:-]{1,100}$/.test(o.outcomeCode)
  )
    fail();
  if (o.available) {
    if (
      !hash(o.evidenceDigest) ||
      !Number.isSafeInteger(o.observedAmountCents) ||
      o.observedAmountCents! < 0 ||
      o.observedAmountCents! > MAX_MONEY_CENTS
    )
      fail();
  } else if (o.observedAmountCents !== null || o.evidenceDigest !== null) fail();
}
// Pure projection only. The service store additionally requires opaque resolution
// authority before persisting any resolve event; a browser string cannot grant it.
export function applyAccountantEvent(
  row: AccountantCaseRow,
  e: AccountantCaseEvent,
  at: string,
): AccountantCaseRow {
  if (
    !/^[1-9]\d{0,18}$/.test(row.version) ||
    BigInt(row.version) >= 9223372036854775807n ||
    !["note", "review", "resolve", "reopen", "observe"].includes(e.kind) ||
    typeof e.reason !== "string" ||
    !e.reason.trim() ||
    e.reason.length > 1000 ||
    time(at) < time(row.firstSeen)
  )
    fail();
  if (e.observation) {
    validateAccountantObservation(e.observation);
    if (time(e.observation.checkedAt) > time(at)) fail();
  }
  if (["observe", "resolve"].includes(e.kind) && !e.observation) fail();
  if (
    e.kind === "resolve" &&
    (!hash(e.proofDigest) || !e.observation?.available || e.observation.observedAmountCents !== 0)
  )
    fail("accountant_resolution_unverified");
  if (e.kind !== "resolve" && e.proofDigest !== null) fail();
  if (["note", "review", "reopen"].includes(e.kind) && e.observation !== null) fail();
  const observation = e.observation ?? row.observation;
  let status = row.status;
  if (e.kind === "resolve") status = "resolved";
  else if (e.kind === "reopen") status = "open";
  else if (e.kind === "review" && status !== "resolved") status = "reviewed";
  else if (
    e.kind === "observe" &&
    status === "resolved" &&
    (!observation.available ||
      observation.evidenceDigest !== row.observation.evidenceDigest ||
      observation.observedAmountCents !== row.observation.observedAmountCents)
  )
    status = "open";
  return freeze(
    structuredClone({
      ...row,
      version: String(BigInt(row.version) + 1n),
      status,
      observation,
      lastChecked: e.observation?.checkedAt ?? row.lastChecked,
      notes: e.kind === "note" ? [...row.notes, e.reason.trim()] : row.notes,
    }),
  );
}
export function accountantAsAtCutoff(asAt: string, now: string): string {
  const n = time(now);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(asAt) ||
    !Number.isFinite(Date.parse(asAt)) ||
    new Date(asAt).toISOString().slice(0, 10) !== asAt
  )
    fail();
  const start = Date.parse(asAt + "T00:00:00+08:00");
  if (start > n) fail("accountant_future_as_at");
  return new Date(Math.min(start + 86400000 - 1, n)).toISOString();
}
export function projectAccountantCases(
  tenantId: string,
  histories: AccountantCaseHistory[],
  input: AccountantListInput,
  historyStartedAt: string,
  now: string,
): AccountantCasePage {
  if (
    !uuid(tenantId) ||
    !["open", "all"].includes(input.status) ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  )
    fail();
  const cutoff = time(accountantAsAtCutoff(input.asAt, now)),
    start = time(historyStartedAt);
  const rows: AccountantCaseRow[] = [],
    seen = new Set<string>();
  for (const h of histories) {
    if (h.tenantId !== tenantId) fail("accountant_scope_mismatch");
    if (seen.has(h.caseId) || !uuid(h.caseId) || !h.events.length) fail();
    seen.add(h.caseId);
    const events = [...h.events].sort(
      (a, b) => time(a.at) - time(b.at) || (BigInt(a.row.version) < BigInt(b.row.version) ? -1 : 1),
    );
    for (const e of events) if (e.row.caseId !== h.caseId) fail("accountant_scope_mismatch");
    const e = events.filter((e) => time(e.at) <= cutoff).at(-1);
    if (e && (input.status === "all" || e.row.status !== "resolved")) rows.push(e.row);
  }
  rows.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.caseId.localeCompare(b.caseId));
  const nextOffset = input.offset + input.limit < rows.length ? input.offset + input.limit : null;
  return structuredClone({
    rows: cutoff < start ? [] : rows.slice(input.offset, input.offset + input.limit),
    asAt: input.asAt,
    generatedAt: now,
    complete: cutoff >= start && input.offset === 0 && nextOffset === null,
    nextOffset,
  });
}
export function snapshotAccountantPage(page: AccountantCasePage): AccountantCasePage {
  if (!page.complete || page.nextOffset !== null) fail("accountant_history_unavailable");
  return freeze(structuredClone(page));
}
