import {
  assertReceiptControllable,
  ReceiptControlError,
  requiresAccountEligibility,
  validateReason,
  validateReceiptControlProposal,
  compareReceiptControl,
  type ReceiptSnapshot,
} from "./receipt-controls";
import type { ReceiptAutomationDTO } from "./receipt-automation";
import { toDTOs, requestFingerprint, type StoreDeps } from "./receipt-controls-store.server";
import { defaultReceiptControlDeps, loadDeposit } from "./receipt-controls-deps.server";
import {
  readReceiptControlEvidence,
  unwrap,
  type ReceiptControlActor,
} from "./receipt-controls-evidence.server";
import { n3Receipts, type N3ExecutionLimit, type N3Outcome } from "./n3-receipts.server";
import {
  buildReceiptUpdatePayload,
  productionUpdateContract,
  updateN3Receipt,
} from "./n3-receipt-update.server";
import {
  automationBudgetMs,
  canAutoUpdate,
  canCreateScopedReceiptUat,
  canExecuteScopedReceiptUat,
  type ReceiptAutomationActor,
} from "./receipt-automation-gates.server";
import {
  supabaseReceiptAutomationDb,
  type AutomationRequestRow,
} from "./receipt-automation-store.server";
import {
  readChangePolicy,
  requireFreshChangeOwner,
  changeAdmin,
} from "./hotel-change-controls-store.server";
import type { ReceiptAutomationDeps } from "./receipt-automation-execution.server";
import { isUuid } from "./reservations-store.server";
export const requireFreshReceiptOwner = requireFreshChangeOwner;
export async function resolveAutomationActor(
  actor: ReceiptControlActor,
): Promise<ReceiptAutomationActor> {
  const r = await (await changeAdmin())
    .from("hotel_tenants")
    .select("n3_tenant_key")
    .eq("id", actor.tenantId)
    .maybeSingle();
  if (r.error || !r.data || typeof r.data.n3_tenant_key !== "string" || !r.data.n3_tenant_key)
    throw new ReceiptControlError("forbidden");
  return { ...actor, n3TenantKey: r.data.n3_tenant_key };
}
export async function toAutomationDTO(
  actor: ReceiptControlActor,
  row: AutomationRequestRow,
  base: StoreDeps = defaultReceiptControlDeps(),
): Promise<ReceiptAutomationDTO> {
  const dto = (await toDTOs(actor, [row], base))[0]!;
  if (row.generation !== 2)
    return { ...dto, automation: null, canApply: false, canCheckResult: false };
  const owner = actor.role === "owner",
    unsettled = ["pending", "needs_review", "approved_awaiting_n3"].includes(row.state);
  const resolved = await resolveAutomationActor(actor),
    contract = productionUpdateContract();
  const enabled =
    canAutoUpdate(resolved, true, contract, process.env) ||
    canExecuteScopedReceiptUat(resolved, true, contract, process.env, row);
  const currentPolicy = await readChangePolicy(actor.tenantId);
  if (!currentPolicy) throw new ReceiptControlError("change_controls_unavailable");
  const requiresApproval =
    !!row.automation &&
    ((row.automation.categories.deposit &&
      (row.automation.policy.depositApprovalRequired || currentPolicy.depositApprovalRequired)) ||
      (row.automation.categories.contact &&
        (row.automation.policy.contactApprovalRequired || currentPolicy.contactApprovalRequired)));
  return {
    ...dto,
    automation: row.automation,
    canApprove: owner && enabled && unsettled && !row.attempt && requiresApproval,
    canApply: owner && enabled && unsettled && !row.attempt && !requiresApproval,
    canReject: owner && unsettled && (!row.attempt || row.attempt.phase === "rejected"),
    canVerify: false,
    canRecover: false,
    canCheckResult: owner && !!row.attempt && ["reserved", "unknown"].includes(row.attempt.phase),
    outcomeMessage:
      row.state === "applied"
        ? "N3 receipt and journal verified. The corrected amount is effective."
        : row.attempt
          ? "Result is held. Check N3 result; the system will not send the change again."
          : !enabled
            ? "Automatic N3 correction is awaiting its verified activation."
            : dto.outcomeMessage,
  };
}
async function boundedEvidence(
  actor: ReceiptControlActor,
  depositId: string,
  limit: N3ExecutionLimit,
): Promise<{ evidence: ReceiptSnapshot; raw: unknown }> {
  let raw: unknown = null;
  const evidence = await readReceiptControlEvidence(actor, depositId, {
    loadDeposit,
    n3: {
      async getById(token, id) {
        const out = await n3Receipts.getById(token, id, limit);
        if (out.kind === "response") raw = unwrap(out.body);
        return out;
      },
      getGLPosting: (token, id) => n3Receipts.getGLPosting(token, id, limit),
    },
  });
  return { evidence, raw };
}
export function defaultReceiptAutomationDeps(): ReceiptAutomationDeps {
  const base = defaultReceiptControlDeps(),
    contract = productionUpdateContract();
  return {
    db: supabaseReceiptAutomationDb(),
    policy: readChangePolicy,
    enabled: (actor, row) =>
      canAutoUpdate(actor, true, contract, process.env) ||
      canExecuteScopedReceiptUat(actor, true, contract, process.env, row),
    budgetMs: automationBudgetMs(process.env),
    now: Date.now,
    freshOwner: requireFreshReceiptOwner,
    async prepare(actor, row, limit) {
      if (!contract) throw new ReceiptControlError("automation_unavailable");
      const { evidence, raw } = await boundedEvidence(actor, row.depositId, limit);
      assertReceiptControllable(evidence);
      if (evidence.sourceFingerprint !== row.original.sourceFingerprint)
        throw new ReceiptControlError("n3_changed_since_request");
      const customer = await base.walkInCustomerId(actor.tenantId);
      if (!customer || customer.toLowerCase() !== row.original.customerId.toLowerCase())
        throw new ReceiptControlError("walk_in_mapping_changed");
      if (row.proposal.kind !== "correction")
        throw new ReceiptControlError("automation_unavailable");
      if (
        requiresAccountEligibility(row.original, row.proposal) &&
        !(await base.resolveAccount(
          actor,
          row.proposal.accountId,
          row.original.paymentLines[0]!.accountId,
        ))
      )
        throw new ReceiptControlError("account_not_allowed");
      return buildReceiptUpdatePayload(raw, row.original, row.proposal, contract);
    },
    send: updateN3Receipt,
    readResult: async (actor, row, limit) =>
      (await boundedEvidence(actor, row.depositId, limit)).evidence,
    noWriteRejected(out: N3Outcome) {
      if (!contract || out.kind !== "response" || out.status >= 500) return false;
      const b = out.body;
      if (!b || typeof b !== "object") return false;
      const codes = Object.entries(b)
        .filter(([k]) => k.toLowerCase() === "code")
        .map(([, v]) => v);
      return (
        codes.length > 0 &&
        codes.every(
          (v) =>
            typeof v === "string" && v === codes[0] && contract.noWriteRejectionCodes.includes(v),
        )
      );
    },
    dto: (actor, row) => toAutomationDTO(actor, row, base),
  };
}
type ReceiptRequestInput = {
  reservationId: unknown;
  depositId: unknown;
  clientRequestId: unknown;
  reason: unknown;
  proposal: unknown;
};
/** Replay is routed by saved generation before current activation/new-request
 * eligibility. It validates against the saved original and never reads N3 or
 * creates/upgrades/dispatches a request. */
export async function findReceiptRequestReplay(
  actor: ReceiptControlActor,
  input: ReceiptRequestInput,
): Promise<ReceiptAutomationDTO | null> {
  if (!["owner", "front_desk"].includes(actor.role)) throw new ReceiptControlError("forbidden");
  if (!isUuid(input.reservationId) || !isUuid(input.depositId) || !isUuid(input.clientRequestId))
    throw new ReceiptControlError("invalid_id");
  const found = await (await changeAdmin())
    .from("hotel_receipt_control_requests")
    .select("id")
    .eq("tenant_id", actor.tenantId)
    .eq("client_request_id", input.clientRequestId)
    .maybeSingle();
  if (found.error) throw new ReceiptControlError("receipt_control_store_failed");
  if (!found.data) return null;
  const old = await supabaseReceiptAutomationDb().get(actor.tenantId, found.data.id);
  if (
    !old ||
    old.requestedBy !== actor.n3UserKey ||
    old.reservationId !== input.reservationId ||
    old.depositId !== input.depositId ||
    old.fingerprint !==
      requestFingerprint(
        input.depositId,
        validateReason(input.reason),
        validateReceiptControlProposal(input.proposal, old.original),
      )
  )
    throw new ReceiptControlError("receipt_control_key_conflict");
  return toAutomationDTO(actor, old);
}
export async function createAutomaticReceiptRequest(
  actor: ReceiptControlActor,
  input: ReceiptRequestInput,
): Promise<ReceiptAutomationDTO> {
  const replay = await findReceiptRequestReplay(actor, input);
  if (replay) {
    if (replay.automation?.generation !== 2)
      throw new ReceiptControlError("receipt_control_key_conflict");
    return replay;
  }
  // findReceiptRequestReplay validated IDs, but narrow them for persistence.
  if (!isUuid(input.reservationId) || !isUuid(input.depositId) || !isUuid(input.clientRequestId))
    throw new ReceiptControlError("invalid_id");
  const base = defaultReceiptControlDeps(),
    policy = await readChangePolicy(actor.tenantId);
  if (!policy) throw new ReceiptControlError("change_controls_unavailable");
  const original = await base.readEvidence(actor, input.depositId);
  assertReceiptControllable(original);
  const reason = validateReason(input.reason),
    proposal = validateReceiptControlProposal(input.proposal, original);
  if (proposal.kind !== "correction") throw new ReceiptControlError("automation_unavailable");
  // With the normal writer OFF, even request creation must match the exact UAT
  // amount-only case. This check precedes persistence, so a wrong draft cannot
  // lock the fixture as an unusable pending automatic request.
  const resolved = await resolveAutomationActor(actor),
    creationActor = { ...resolved, role: "owner" as const },
    contract = productionUpdateContract();
  if (
    !canAutoUpdate(creationActor, true, contract, process.env) &&
    !canExecuteScopedReceiptUat(creationActor, true, contract, process.env, {
      generation: 2,
      tenantId: actor.tenantId,
      reservationId: input.reservationId,
      depositId: input.depositId,
      original,
      proposal,
    })
  )
    throw new ReceiptControlError("automation_unavailable");
  if (
    requiresAccountEligibility(original, proposal) &&
    !(await base.resolveAccount(actor, proposal.accountId, original.paymentLines[0]!.accountId))
  )
    throw new ReceiptControlError("account_not_allowed");
  const row = await supabaseReceiptAutomationDb().create(
    actor,
    {
      reservationId: input.reservationId,
      depositId: input.depositId,
      clientRequestId: input.clientRequestId,
      fingerprint: requestFingerprint(input.depositId, reason, proposal),
      reason,
      original,
      proposal,
      comparison: compareReceiptControl(original, proposal),
    },
    policy,
  );
  return toAutomationDTO(actor, row, base);
}

export async function automaticReceiptCreationReady(
  actor: ReceiptControlActor,
  selection?: { reservationId: unknown; depositId: unknown },
): Promise<boolean> {
  if (!productionUpdateContract()) return false;
  const resolved = await resolveAutomationActor(actor);
  if ((await readChangePolicy(actor.tenantId)) === null) return false;
  const creationActor = { ...resolved, role: "owner" as const },
    contract = productionUpdateContract();
  if (canAutoUpdate(creationActor, true, contract, process.env)) return true;
  if (
    !selection ||
    process.env.HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED !== "true" ||
    !isUuid(selection.reservationId) ||
    !isUuid(selection.depositId)
  )
    return false;
  const deposit = await loadDeposit(actor.tenantId, selection.depositId);
  return (
    !!deposit &&
    canCreateScopedReceiptUat(creationActor, true, contract, process.env, {
      reservationId: selection.reservationId,
      deposit,
    })
  );
}
