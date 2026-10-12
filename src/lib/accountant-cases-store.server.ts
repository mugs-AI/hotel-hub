import { createHash } from "node:crypto";
import type { SettlementActor } from "./settlement-context.server";
import type { StoredIntent } from "./settlement-dispatch.server";
import type { SettlementRpc } from "./settlement-store.server";
import {
  externalMatchEvidenceForStore,
  type ExternalMatchProof,
} from "./settlement-manual-evidence.server";
import {
  accountantCaseKey,
  accountantAsAtCutoff,
  validateAccountantObservation,
  snapshotAccountantPage,
  type AccountantCaseKey,
  type AccountantCaseObservation,
  type AccountantCaseEvent,
  type AccountantCaseRow,
  type AccountantCasePage,
  type AccountantStatement,
  type AccountantListInput,
} from "./accountant-cases";
export type AccountantActor = Omit<SettlementActor, "reservationId">;
declare const caseBindingBrand: unique symbol;
export type AccountantCaseBinding = {
  readonly [caseBindingBrand]: true;
  caseId: string;
  version: string;
  key: AccountantCaseKey;
  documentIds: string[];
};
const rowBindings = new WeakMap<AccountantCaseRow, { actor: AccountantActor; at: number }>();
const bindings = new WeakMap<AccountantCaseBinding, { actor: AccountantActor; at: number }>();
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
function fail(code = "accountant_invalid_input"): never {
  throw new Error(code);
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function actorArgs(a: AccountantActor) {
  if (a.role !== "owner" || !uuid(a.tenantId) || !a.n3UserKey?.trim() || !a.n3Token?.trim())
    fail("accountant_forbidden");
  return { p_tenant: a.tenantId, p_actor: a.n3UserKey };
}
function date(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\d$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
function timestamp(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
function parseRow(value: unknown): AccountantCaseRow {
  if (
    !record(value) ||
    !uuid(value.caseId) ||
    !revision(value.version) ||
    !record(value.key) ||
    !["open", "reviewed", "resolved"].includes(String(value.status)) ||
    !record(value.observation) ||
    typeof value.bookingReference !== "string" ||
    !date(value.stayFrom) ||
    !date(value.stayTo) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !timestamp(value.firstSeen) ||
    (value.lastChecked !== null && !timestamp(value.lastChecked)) ||
    typeof value.nextAction !== "string" ||
    !Array.isArray(value.notes) ||
    value.notes.some((n) => typeof n !== "string" || n.length > 1000) ||
    !Array.isArray(value.documentReferences)
  )
    fail("accountant_invalid_result");
  const key = accountantCaseKey(value.key as AccountantCaseKey);
  validateAccountantObservation(value.observation as AccountantCaseObservation);
  const refs = value.documentReferences;
  if (
    refs.length !== key.documentIds.length ||
    refs.some(
      (d) =>
        !record(d) ||
        !uuid(d.id) ||
        !key.documentIds.includes(d.id) ||
        typeof d.code !== "string" ||
        !date(d.date),
    ) ||
    new Set(refs.map((d) => (d as Record<string, unknown>).id)).size !== refs.length
  )
    fail("accountant_invalid_result");
  // Explicit projection excludes any unexpected credentials/private fields.
  return freeze(
    structuredClone({
      caseId: value.caseId,
      version: value.version,
      key,
      bookingReference: value.bookingReference,
      stayFrom: value.stayFrom,
      stayTo: value.stayTo,
      documentReferences: refs.map((d) => ({ id: d.id, code: d.code, date: d.date })),
      currency: value.currency,
      firstSeen: value.firstSeen,
      lastChecked: value.lastChecked,
      status: value.status,
      observation: {
        available: value.observation.available,
        checkedAt: value.observation.checkedAt,
        evidenceDigest: value.observation.evidenceDigest,
        observedAmountCents: value.observation.observedAmountCents,
        outcomeCode: value.observation.outcomeCode,
      },
      nextAction: value.nextAction,
      notes: value.notes,
    }),
  ) as AccountantCaseRow;
}
function parsePage(value: unknown): AccountantCasePage {
  if (
    !record(value) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 1000 ||
    !date(value.asAt) ||
    !timestamp(value.generatedAt) ||
    typeof value.complete !== "boolean" ||
    (value.nextOffset !== null &&
      (!Number.isSafeInteger(value.nextOffset) || Number(value.nextOffset) < 1)) ||
    (value.complete && value.nextOffset !== null)
  )
    fail("accountant_invalid_result");
  const rows = value.rows.map(parseRow);
  if (new Set(rows.map((r) => r.caseId)).size !== rows.length) fail("accountant_invalid_result");
  return {
    rows,
    asAt: value.asAt as string,
    generatedAt: value.generatedAt as string,
    complete: value.complete,
    nextOffset: value.nextOffset as number | null,
  };
}
function parseStatement(value: unknown): AccountantStatement {
  if (
    !record(value) ||
    !uuid(value.statementId) ||
    typeof value.digest !== "string" ||
    typeof value.pageText !== "string" ||
    Buffer.byteLength(value.pageText, "utf8") > 2000000 ||
    createHash("sha256").update(value.pageText).digest("hex") !== value.digest
  )
    fail("accountant_statement_unverified");
  const page = snapshotAccountantPage(parsePage(JSON.parse(value.pageText)));
  return freeze({ statementId: value.statementId, digest: value.digest, page });
}
function current(
  meta: { actor: AccountantActor; at: number } | undefined,
  a: AccountantActor,
): boolean {
  return (
    !!meta &&
    a.role === "owner" &&
    meta.actor.tenantId === a.tenantId &&
    meta.actor.n3UserKey === a.n3UserKey &&
    meta.actor.n3Token === a.n3Token &&
    Date.now() >= meta.at &&
    Date.now() - meta.at <= 60000
  );
}
export function accountantCaseBinding(
  row: AccountantCaseRow,
  a: AccountantActor,
): AccountantCaseBinding | null {
  const meta = rowBindings.get(row);
  if (!current(meta, a)) return null;
  const value = freeze({
    caseId: row.caseId,
    version: row.version,
    key: row.key,
    documentIds: row.key.documentIds,
  }) as AccountantCaseBinding;
  bindings.set(value, meta!);
  return value;
}
export function accountantBindingBoundTo(
  binding: AccountantCaseBinding,
  a: AccountantActor,
  intent: StoredIntent,
): boolean {
  return (
    current(bindings.get(binding), a) &&
    binding.key.intentId === intent.id &&
    binding.key.reservationId === intent.reservationId &&
    intent.tenantId === a.tenantId
  );
}
const errors = new Set([
  "accountant_scope_mismatch",
  "accountant_stale_version",
  "accountant_idempotency_conflict",
  "accountant_resolution_unverified",
  "accountant_history_unavailable",
  "accountant_invalid_input",
]);
export function createAccountantCaseStore(rpc: SettlementRpc) {
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const r = await rpc(name, args);
    if (r.error) {
      if (["PGRST202", "PGRST205", "42883", "42P01"].includes(r.error.code ?? ""))
        fail("accountant_setup_required");
      if (r.error.message === "settlement_forbidden") fail("accountant_forbidden");
      fail(errors.has(r.error.message ?? "") ? r.error.message! : "accountant_store_unavailable");
    }
    return r.data;
  }
  return {
    async ensureOpen(
      a: AccountantActor,
      key: AccountantCaseKey,
      observation: AccountantCaseObservation,
      requestId: string,
    ): Promise<AccountantCaseRow> {
      const args = actorArgs(a),
        canonical = accountantCaseKey(key);
      validateAccountantObservation(observation);
      if (!uuid(requestId)) fail();
      const row = parseRow(
        await call("hotelhub_accountant_case_open", {
          ...args,
          p_key: canonical,
          p_observation: observation,
          p_request: requestId,
        }),
      );
      if (JSON.stringify(row.key) !== JSON.stringify(canonical)) fail("accountant_scope_mismatch");
      return row;
    },
    async readCase(a: AccountantActor, caseId: string): Promise<AccountantCaseRow> {
      const args = actorArgs(a);
      if (!uuid(caseId)) fail();
      const row = parseRow(
        await call("hotelhub_accountant_case_read", { ...args, p_case: caseId }),
      );
      if (row.caseId !== caseId) fail("accountant_scope_mismatch");
      rowBindings.set(row, { actor: { ...a }, at: Date.now() });
      return row;
    },
    async append(
      a: AccountantActor,
      caseId: string,
      expectedVersion: string,
      event: AccountantCaseEvent,
      requestId: string,
      authority?: { intent: StoredIntent; proof: ExternalMatchProof },
    ): Promise<AccountantCaseRow> {
      const args = actorArgs(a);
      if (
        !uuid(caseId) ||
        !uuid(requestId) ||
        !revision(expectedVersion) ||
        !event ||
        !["note", "review", "resolve", "reopen", "observe"].includes(event.kind) ||
        typeof event.reason !== "string" ||
        !event.reason.trim() ||
        event.reason.length > 1000
      )
        fail();
      let resolution: Record<string, unknown> | null = null;
      if (event.kind === "resolve") {
        // A durable, identical committed result remains replayable after a
        // restart or evidence expiry. This SELECT cannot authorize a new write.
        const replay = await call("hotelhub_accountant_case_event_replay", {
          ...args,
          p_case: caseId,
          p_version: expectedVersion,
          p_event: event,
          p_request: requestId,
        });
        if (replay !== null) {
          const saved = parseRow(replay);
          if (saved.caseId !== caseId) fail("accountant_scope_mismatch");
          return saved;
        }
        if (!authority) fail("accountant_resolution_unverified");
        resolution = externalMatchEvidenceForStore(
          authority.proof,
          { ...a, reservationId: authority.intent.reservationId },
          authority.intent,
        );
        if (
          !resolution ||
          event.proofDigest !== resolution.digest ||
          event.observation?.evidenceDigest !== resolution.observationDigest ||
          event.observation?.observedAmountCents !== 0
        )
          fail("accountant_resolution_unverified");
      } else if (event.proofDigest !== null || authority) fail();
      if (event.observation) validateAccountantObservation(event.observation);
      const row = parseRow(
        await call("hotelhub_accountant_case_event", {
          ...args,
          p_case: caseId,
          p_version: expectedVersion,
          p_event: event,
          p_request: requestId,
          p_resolution: resolution,
        }),
      );
      if (row.caseId !== caseId) fail("accountant_scope_mismatch");
      return row;
    },
    async read(a: AccountantActor, input: AccountantListInput): Promise<AccountantCasePage> {
      const args = actorArgs(a);
      accountantAsAtCutoff(input.asAt, new Date().toISOString());
      if (
        !["open", "all"].includes(input.status) ||
        !Number.isSafeInteger(input.offset) ||
        input.offset < 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        fail();
      const page = parsePage(
        await call("hotelhub_accountant_cases_read", {
          ...args,
          p_as_at: input.asAt,
          p_status: input.status,
          p_offset: input.offset,
          p_limit: input.limit,
        }),
      );
      if (page.asAt !== input.asAt || page.rows.length > input.limit)
        fail("accountant_invalid_result");
      return page;
    },
    async saveStatement(
      a: AccountantActor,
      input: Pick<AccountantListInput, "asAt" | "status">,
      requestId: string,
    ): Promise<AccountantStatement> {
      const args = actorArgs(a);
      accountantAsAtCutoff(input.asAt, new Date().toISOString());
      if (!uuid(requestId) || !["open", "all"].includes(input.status)) fail();
      const statement = parseStatement(
        await call("hotelhub_accountant_statement", {
          ...args,
          p_as_at: input.asAt,
          p_status: input.status,
          p_request: requestId,
        }),
      );
      if (statement.page.asAt !== input.asAt) fail("accountant_statement_unverified");
      return statement;
    },
    async readStatement(a: AccountantActor, statementId: string): Promise<AccountantStatement> {
      const args = actorArgs(a);
      if (!uuid(statementId)) fail();
      const s = parseStatement(
        await call("hotelhub_accountant_statement_read", { ...args, p_statement: statementId }),
      );
      if (s.statementId !== statementId) fail("accountant_scope_mismatch");
      return s;
    },
  };
}
export type AccountantCaseStore = ReturnType<typeof createAccountantCaseStore>;
