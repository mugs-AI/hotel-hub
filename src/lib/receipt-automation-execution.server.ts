import { ReceiptControlError, type ReceiptSnapshot } from "./receipt-controls";
import { verifyReceiptControlResult } from "./receipt-controls-evidence.server";
import type { ChangePolicy } from "./hotel-change-controls";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
import type { PreparedReceiptUpdate } from "./n3-receipt-update.server";
import type { N3Outcome, N3ExecutionLimit } from "./n3-receipts.server";
import type { ReceiptApplyResult, ReceiptAutomationDTO } from "./receipt-automation";
import type {
  ReceiptAutomationDb,
  AutomationRequestRow,
  AutomationSettlement,
} from "./receipt-automation-store.server";
import { successfulEnvelope } from "./deposits-store.server";
import { isUuid } from "./reservations-store.server";
export type ReceiptAutomationDeps = {
  db: ReceiptAutomationDb;
  policy: (tenant: string) => Promise<ChangePolicy | null>;
  enabled: (actor: ReceiptAutomationActor) => boolean;
  budgetMs: number | null;
  now: () => number;
  freshOwner: (actor: ReceiptAutomationActor) => Promise<void>;
  prepare: (
    actor: ReceiptAutomationActor,
    row: AutomationRequestRow,
    limit: N3ExecutionLimit,
  ) => Promise<PreparedReceiptUpdate>;
  send: (
    actor: ReceiptAutomationActor,
    prepared: PreparedReceiptUpdate,
    limit: N3ExecutionLimit,
  ) => Promise<N3Outcome>;
  readResult: (
    actor: ReceiptAutomationActor,
    row: AutomationRequestRow,
    limit: N3ExecutionLimit,
  ) => Promise<ReceiptSnapshot>;
  noWriteRejected: (outcome: N3Outcome) => boolean;
  dto: (actor: ReceiptAutomationActor, row: AutomationRequestRow) => Promise<ReceiptAutomationDTO>;
};
function owner(actor: ReceiptAutomationActor) {
  if (actor.role !== "owner" || !actor.n3TenantKey) throw new ReceiptControlError("forbidden");
}
async function get(actor: ReceiptAutomationActor, id: string, deps: ReceiptAutomationDeps) {
  owner(actor);
  if (!isUuid(id)) throw new ReceiptControlError("invalid_id");
  const r = await deps.db.get(actor.tenantId, id);
  if (!r) throw new ReceiptControlError("request_not_found");
  if (r.generation !== 2 || !r.automation || r.kind !== "correction")
    throw new ReceiptControlError("automation_unavailable");
  return r;
}
async function response(
  actor: ReceiptAutomationActor,
  row: AutomationRequestRow,
  deps: ReceiptAutomationDeps,
  code: string,
): Promise<ReceiptApplyResult> {
  return {
    request: await deps.dto(actor, row),
    outcome:
      row.state === "applied"
        ? "applied"
        : row.state === "needs_review" || row.attempt
          ? "needs_review"
          : "on_hold",
    code,
  };
}
function budget(deps: ReceiptAutomationDeps) {
  if (!deps.budgetMs || deps.budgetMs <= 0) throw new ReceiptControlError("automation_unavailable");
  const controller = new AbortController();
  const deadlineAt = deps.now() + deps.budgetMs;
  const limit = { deadlineAt, signal: controller.signal };
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    const remaining = deadlineAt - deps.now();
    if (remaining <= 0 || controller.signal.aborted)
      throw new ReceiptControlError("execution_deadline");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ReceiptControlError("execution_deadline"));
          }, remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return { limit, run, close: () => controller.abort() };
}
const safeCode = (err: unknown) =>
  err instanceof ReceiptControlError ? err.code : "receipt_control_store_failed";
async function hold(
  actor: ReceiptAutomationActor,
  row: AutomationRequestRow,
  deps: ReceiptAutomationDeps,
  code: string,
) {
  try {
    if (row.attempt)
      row = await deps.db.settle(
        actor,
        row.id,
        row.attempt.id,
        row.attempt.claimedVersion,
        row.version,
        { kind: "unknown", code },
      );
    else row = await deps.db.hold(actor, row.id, row.version, code);
  } catch {
    row = (await deps.db.get(actor.tenantId, row.id)) ?? row;
  }
  return response(actor, row, deps, code);
}
async function reconcile(
  actor: ReceiptAutomationActor,
  row: AutomationRequestRow,
  deps: ReceiptAutomationDeps,
  b: ReturnType<typeof budget>,
) {
  if (!row.attempt) throw new ReceiptControlError("claim_not_found");
  if (row.state === "applied") return response(actor, row, deps, "verified");
  if (row.attempt.phase === "rejected") return response(actor, row, deps, "n3_rejected_no_write");
  const evidence = await b.run(() => deps.readResult(actor, row, b.limit));
  if (verifyReceiptControlResult(row.original, row.proposal, evidence) !== "verified")
    return hold(actor, row, deps, "n3_result_unproven");
  await b.run(() => deps.freshOwner(actor));
  const result: AutomationSettlement = {
    kind: "verified",
    version: {
      state: "active",
      receiptId: evidence.receiptId,
      docCode: evidence.docCode,
      documentDate: evidence.documentDate,
      currency: evidence.currency,
      amountCents: evidence.amountCents,
      paymentLines: evidence.paymentLines,
      replacementOf: null,
      fingerprint: evidence.sourceFingerprint,
    },
    contact: evidence.contact,
  };
  const done = await b.run(() =>
    deps.db.settle(
      actor,
      row.id,
      row.attempt!.id,
      row.attempt!.claimedVersion,
      row.version,
      result,
    ),
  );
  return response(actor, done, deps, "verified");
}
export async function applyReceiptCorrection(
  actor: ReceiptAutomationActor,
  input: { requestId: string; expectedVersion: number; action: "approve" | "apply" },
  deps: ReceiptAutomationDeps,
): Promise<ReceiptApplyResult> {
  let row = await get(actor, input.requestId, deps);
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !["approve", "apply"].includes(input.action)
  )
    throw new ReceiptControlError("invalid_body");
  // Replay never reserves or sends again, even after a lost successful response.
  if (row.state === "applied") return response(actor, row, deps, "verified");
  if (row.attempt) return response(actor, row, deps, "existing_attempt_check_result");
  if (!deps.enabled(actor)) throw new ReceiptControlError("automation_unavailable");
  if (row.version !== input.expectedVersion) throw new ReceiptControlError("version_conflict");
  const b = budget(deps);
  try {
    await b.run(() => deps.freshOwner(actor));
    const policy = await b.run(() => deps.policy(actor.tenantId));
    if (!policy) throw new ReceiptControlError("change_controls_unavailable");
    row = await b.run(() =>
      deps.db.authorize(
        actor,
        row.id,
        input.expectedVersion,
        input.action === "approve" ? "manual_approval" : "direct_policy",
        policy.revision,
      ),
    );
    const prepared = await b.run(() => deps.prepare(actor, row, b.limit));
    await b.run(() => deps.freshOwner(actor));
    // SQL locks and rechecks the current policy revision and real approval here.
    const latest = await b.run(() => deps.policy(actor.tenantId));
    if (!latest) throw new ReceiptControlError("change_controls_unavailable");
    const reserved = await b.run(() =>
      deps.db.reserveDispatch(actor, row.id, row.version, prepared.payloadHash, latest.revision),
    );
    row = (await deps.db.get(actor.tenantId, row.id)) ?? { ...row, attempt: reserved.attempt };
    if (!reserved.dispatchGranted)
      return response(actor, row, deps, "existing_attempt_check_result");
    await b.run(() => deps.freshOwner(actor));
    if (!deps.enabled(actor)) throw new ReceiptControlError("automation_unavailable");
    const out = await b.run(() => deps.send(actor, prepared, b.limit));
    if (
      out.kind !== "response" ||
      out.status < 200 ||
      out.status >= 300 ||
      !successfulEnvelope(out.body)
    ) {
      if (deps.noWriteRejected(out)) {
        row = await deps.db.settle(
          actor,
          row.id,
          reserved.attempt.id,
          reserved.attempt.claimedVersion,
          row.version,
          { kind: "rejected_no_write", code: "n3_rejected_no_write" },
        );
        return response(actor, row, deps, "n3_rejected_no_write");
      }
      return hold(actor, row, deps, "n3_update_unknown");
    }
    return await reconcile(actor, row, deps, b);
  } catch (err) {
    return hold(actor, row, deps, safeCode(err));
  } finally {
    b.close();
  }
}
export async function checkReceiptCorrectionResult(
  actor: ReceiptAutomationActor,
  id: string,
  deps: ReceiptAutomationDeps,
): Promise<ReceiptApplyResult> {
  const row = await get(actor, id, deps);
  const b = budget(deps);
  try {
    await b.run(() => deps.freshOwner(actor));
    return await reconcile(actor, row, deps, b);
  } catch (err) {
    return hold(actor, row, deps, safeCode(err));
  } finally {
    b.close();
  }
}
