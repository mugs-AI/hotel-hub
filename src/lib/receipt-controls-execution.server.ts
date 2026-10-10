// Server-only execution for approved receipt requests. Automated N3 writes are
// not implemented: the official Update/Void semantics are unproven, so the
// only supported flow is manual change in N3 followed by GET-only readback.
import {
  MANUAL_APPROVAL_MESSAGE,
  ReceiptControlError,
  type ReceiptControlRequestDTO,
  type ReceiptSnapshot,
} from "./receipt-controls";
import {
  receiptControlCapabilities,
  verifyReceiptControlResult,
  type ReceiptControlActor,
} from "./receipt-controls-evidence.server";
import { toDTOs, type StoreDeps, type VersionPayload } from "./receipt-controls-store.server";

/** "Execute" never writes to N3: it returns the manual instruction. */
export async function executeReceiptControlRequest(
  actor: ReceiptControlActor,
  requestId: string,
  deps: StoreDeps,
  capabilities = receiptControlCapabilities(),
): Promise<{ request: ReceiptControlRequestDTO; message: string }> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  const row = await deps.db.get(actor.tenantId, requestId);
  if (!row) throw new ReceiptControlError("request_not_found");
  if (row.generation === 2) throw new ReceiptControlError("automation_unavailable");
  if (row.state !== "approved_awaiting_n3") throw new ReceiptControlError("invalid_transition");
  if (capabilities.directEdit || capabilities.voidReplace)
    // No proven contract is wired; refuse rather than guess an endpoint.
    throw new ReceiptControlError("automation_unavailable");
  const [request] = await toDTOs(actor, [row], deps);
  return { request: request!, message: MANUAL_APPROVAL_MESSAGE };
}

/**
 * Read the receipt back from N3 and record the outcome atomically. Absence,
 * unknown cancellation/matching or any mismatch holds Needs review; only an
 * exact match appends an effective receipt version.
 */
export async function verifyReceiptControlRequest(
  actor: ReceiptControlActor,
  input: { requestId: string; expectedVersion: unknown },
  deps: StoreDeps,
): Promise<ReceiptControlRequestDTO> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  if (!Number.isInteger(input.expectedVersion)) throw new ReceiptControlError("version_conflict");
  const row = await deps.db.get(actor.tenantId, input.requestId);
  if (!row) throw new ReceiptControlError("request_not_found");
  if (row.generation === 2) throw new ReceiptControlError("automation_unavailable");
  if (row.state !== "approved_awaiting_n3" && row.state !== "needs_review")
    throw new ReceiptControlError("invalid_transition");
  if (!row.approvedAt)
    // Held before approval (pending -> Hold -> Needs review): never verifiable.
    throw new ReceiptControlError("not_approved");

  // Read first: an expired N3 session changes nothing.
  let evidence: ReceiptSnapshot | null = null;
  let evidenceCode: string | null = null;
  try {
    evidence = await deps.readEvidence(actor, row.depositId);
  } catch (e) {
    if (e instanceof ReceiptControlError && e.code === "unauthorized") throw e;
    evidenceCode = "n3_evidence_insufficient";
  }
  const result = evidence
    ? verifyReceiptControlResult(row.original, row.proposal, evidence)
    : "insufficient";
  let version: VersionPayload | null = null;
  if (result === "verified" && evidence) {
    version = {
      state: row.proposal.kind === "void" ? "voided" : "active",
      receiptId: evidence.receiptId,
      docCode: evidence.docCode,
      documentDate: evidence.documentDate,
      currency: evidence.currency,
      amountCents: row.proposal.kind === "void" ? row.original.amountCents : evidence.amountCents,
      paymentLines: evidence.paymentLines,
      replacementOf: null,
      fingerprint: evidence.sourceFingerprint,
    };
  }
  const outcomeCode =
    result === "verified"
      ? "verified"
      : result === "mismatch"
        ? "n3_result_mismatch"
        : (evidenceCode ?? "n3_evidence_insufficient");
  // One transaction: claim + complete + version. A crash here leaves nothing claimed.
  const done = await deps.db.verifyAtomic({
    tenantId: actor.tenantId,
    requestId: row.id,
    expectedVersion: input.expectedVersion as number,
    toState: result === "verified" ? "applied" : "needs_review",
    outcomeCode,
    actor: actor.n3UserKey,
    version,
  });
  await deps.audit({
    tenantId: actor.tenantId,
    n3UserKey: actor.n3UserKey,
    eventType: "hotel.receipt_control.verified",
    detail: { requestId: done.id, outcome: outcomeCode },
  });
  return (await toDTOs(actor, [done], deps))[0]!;
}

/** Stale window before an in-flight verification may be recovered. */
export const RECEIPT_VERIFY_STALE_SECONDS = 300;

/**
 * Owner recovery of an interrupted verification. Read-only toward N3: no
 * GET, no write, no retry. Releases only a stale claim and bumps the version so
 * the old worker can never complete it; the Owner then runs Verify again.
 */
export async function recoverReceiptControlRequest(
  actor: ReceiptControlActor,
  input: { requestId: string; expectedVersion: unknown },
  deps: StoreDeps,
): Promise<ReceiptControlRequestDTO> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  if (!Number.isInteger(input.expectedVersion)) throw new ReceiptControlError("version_conflict");
  const row = await deps.db.get(actor.tenantId, input.requestId);
  if (!row) throw new ReceiptControlError("request_not_found");
  if (row.generation === 2) throw new ReceiptControlError("automation_unavailable");
  if ((row.state !== "applying" && row.state !== "needs_review") || !row.approvedAt)
    throw new ReceiptControlError("invalid_transition");
  const done = await deps.db.recover({
    tenantId: actor.tenantId,
    requestId: row.id,
    expectedVersion: input.expectedVersion as number,
    actor: actor.n3UserKey,
    staleSeconds: RECEIPT_VERIFY_STALE_SECONDS,
  });
  await deps.audit({
    tenantId: actor.tenantId,
    n3UserKey: actor.n3UserKey,
    eventType: "hotel.receipt_control.recovered",
    detail: { requestId: done.id, outcome: "verification_interrupted" },
  });
  return (await toDTOs(actor, [done], deps))[0]!;
}
