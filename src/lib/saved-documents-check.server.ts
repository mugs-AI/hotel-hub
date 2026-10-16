import type { SettlementActor } from "./settlement-context.server";
import type { StoredIntent } from "./settlement-dispatch.server";
import type { SavedDocumentCheck } from "./saved-documents-check";
import type { EvidenceResult, SettlementSnapshot } from "./settlement";
import { billingPayloadDigest } from "./n3-billing.server";
import {
  proveExternalMatching,
  externalMatchEvidenceForStore,
  type ExternalMatchProof,
} from "./settlement-manual-evidence.server";
import type { N3Outcome } from "./n3-receipts.server";
import { n3BillingClient, type BillingReadLimit, type N3BillingClient } from "./n3-billing.server";
import { persistedIntentBoundTo, persistedDispatchBoundTo } from "./settlement-store.server";
import {
  proveBill,
  proveReceiptBefore,
  type SettlementReceipt,
  type VerifiedBill,
  type VerifiedReceiptBefore,
} from "./settlement-evidence.server";
import { isN3Guid } from "./n3-guid";
import { isUuid } from "./reservations-store.server";

export type SavedCheckDeps = {
  snapshot?(
    actor: SettlementActor,
    frozen: SettlementSnapshot,
  ): Promise<EvidenceResult<SettlementSnapshot>>;
  loadIntent(actor: SettlementActor): Promise<StoredIntent | null>;
  client?: Pick<
    N3BillingClient,
    "readBill" | "readBillJournal" | "readReceipt" | "readReceiptJournal"
  >;
  now(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  authorize(actor: SettlementActor): Promise<boolean>;
  invalidateSession(): Promise<void>;
  deadlineAt?: number;
  signal?: AbortSignal;
};
const externalChecks = new WeakMap<
  SavedDocumentCheck,
  {
    actor: SettlementActor;
    intent: StoredIntent;
    proof: ExternalMatchProof;
    resultHash: string;
  }
>();
/** Private evidence port for later settlement integration; a browser copy has no authority. */
export function externalMatchingEvidenceForCheck(
  result: SavedDocumentCheck,
  actor: SettlementActor,
  intentId: string,
): Record<string, unknown> | null {
  const m = externalChecks.get(result);
  if (!m || m.intent.id !== intentId || m.resultHash !== billingPayloadDigest(result)) return null;
  return externalMatchEvidenceForStore(m.proof, actor, m.intent);
}
const names = ["identity", "status", "money", "journal", "relationships", "completeness"] as const;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safeCode = (v: unknown) =>
  typeof v === "string" && /^[a-z_0-9]{1,96}$/.test(v) ? v : "other_n3_error";
class Stop extends Error {
  constructor(
    readonly status: SavedDocumentCheck["status"],
    readonly code: string,
  ) {
    super(code);
  }
}
type Target = { kind: "bill" | "receipt"; id: string; receipt?: SettlementReceipt };
function targets(
  actor: SettlementActor,
  intent: StoredIntent,
  known: (t: Target) => void,
): Target[] {
  const bill = intent.dispatches.filter((d) => d.claim.kind === "bill");
  if (
    bill.length !== 1 ||
    !persistedDispatchBoundTo(bill[0], actor, intent.id, intent.snapshot.digest)
  )
    throw new Stop("needs_review", "settlement_bill_identity_unavailable");
  const id = bill[0].outcome?.documentId;
  if (!isN3Guid(id)) throw new Stop("needs_review", "settlement_identity_requires_review");
  const result: Target[] = [];
  const add = (t: Target) => {
    if (!isN3Guid(t.id)) throw new Stop("needs_review", "settlement_identity_requires_review");
    result.push(t);
    known(t);
  };
  add({ kind: "bill", id });
  for (const receipt of intent.snapshot.receipts) {
    if (
      receipt.reservationId !== intent.reservationId ||
      receipt.customerId !== intent.snapshot.customerId ||
      receipt.currency !== intent.snapshot.currency
    )
      throw new Stop("needs_review", "receipt_scope_mismatch");
    add({ kind: "receipt", id: receipt.receiptId, receipt });
  }
  for (const d of intent.dispatches.filter((d) => d.claim.kind === "balance_receipt")) {
    if (
      !persistedDispatchBoundTo(d, actor, intent.id, intent.snapshot.digest) ||
      d.facts?.kind !== "balance_receipt"
    )
      throw new Stop("needs_review", "settlement_identity_requires_review");
    const rid = d.outcome?.documentId,
      f = d.facts;
    if (!isN3Guid(rid)) throw new Stop("needs_review", "settlement_identity_requires_review");
    add({
      kind: "receipt",
      id: rid,
      receipt: {
        purpose: "settlement",
        intentId: intent.id,
        reservationId: intent.reservationId,
        receiptId: rid,
        reference: String(f.payload.referenceNo),
        customerId: intent.snapshot.customerId,
        currency: intent.snapshot.currency,
        amountCents: f.input.amountCents,
        receiptDate: f.input.docDate,
        payments: [
          {
            accountId: f.account.id,
            accountCode: f.account.code,
            accountName: f.account.name,
            amountCents: f.input.amountCents,
          },
        ],
      },
    });
  }
  if (
    result.length > 12 ||
    result.some((t) => !isN3Guid(t.id)) ||
    new Set(result.map((t) => t.id.toLowerCase())).size !== result.length
  )
    throw new Stop("needs_review", "settlement_document_scope_invalid");
  return result;
}
function absent(out: N3Outcome): boolean {
  if (out.kind === "transport_error") {
    if (out.reason === "too_large") throw new Stop("needs_review", "n3_response_too_large");
    return true;
  }
  if (out.status === 403) throw new Stop("needs_review", "n3_permission_denied");
  if (out.status === 404 || out.status >= 500) return true;
  if (out.status < 200 || out.status >= 300)
    throw new Stop("needs_review", "n3_business_result_uncertain");
  if (!plain(out.body)) return true;
  if (out.body.code !== "0000") throw new Stop("needs_review", "n3_business_result_uncertain");
  let data = out.body.data;
  if (plain(data) && "value" in data) data = data.value;
  return data === null || data === undefined || (Array.isArray(data) && data.length === 0);
}
export async function checkSavedDocuments(
  actor: SettlementActor,
  intentId: string,
  deps: SavedCheckDeps,
  mode: "documents" | "external_matching" = "documents",
): Promise<SavedDocumentCheck> {
  const clock = deps.now,
    controller = new AbortController();
  const deadlineAt = Math.min(deps.deadlineAt ?? Infinity, clock() + 40_000);
  let cancelCode = "verification_deadline";
  const onAbort = () => {
    cancelCode = "verification_cancelled";
    controller.abort();
  };
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  if (deps.signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - clock()));
  const limit: BillingReadLimit = {
    deadlineAt,
    signal: controller.signal,
    budget: { remainingBytes: 2_000_000 },
  };
  const result: SavedDocumentCheck = {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    intentId,
    status: "needs_review",
    code: "settlement_unavailable",
    checkedAt: new Date(clock()).toISOString(),
    observations: 0,
    persistenceProven: false,
    billOutstandingCents: null,
    documents: [],
    attempts: [],
    responses: [],
    checks: [],
  };
  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted || clock() >= deadlineAt) throw new Stop("waiting", cancelCode);
    let listener: (() => void) | undefined;
    const stopped = new Promise<never>((_r, reject) => {
      listener = () => reject(new Stop("waiting", cancelCode));
      controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      const value = await Promise.race([work(), stopped]);
      if (controller.signal.aborted || clock() >= deadlineAt) throw new Stop("waiting", cancelCode);
      return value;
    } finally {
      if (listener) controller.signal.removeEventListener("abort", listener);
    }
  }
  async function authorize() {
    if (!(await run(() => deps.authorize(actor)))) throw new Stop("unauthorized", "scope_lost");
  }
  async function read(
    documentId: string,
    operation: "detail" | "journal",
    work: () => Promise<N3Outcome>,
  ) {
    await authorize();
    const out = await run(work);
    const body = out.kind === "response" && plain(out.body) ? out.body : null;
    result.responses.push({
      documentId,
      operation,
      httpStatus: out.kind === "response" ? out.status : null,
      businessCode:
        typeof body?.code === "string" && /^[A-Z0-9]{4,12}$/.test(body.code) ? body.code : null,
    });
    if (out.kind === "transport_error" && out.reason === "too_large")
      throw new Stop("needs_review", "n3_response_too_large");
    if (out.kind === "response" && out.status === 401) {
      controller.abort();
      // Auth failure takes priority even if session cleanup/audit is unavailable.
      // Cleanup may settle later; it must not authorize any further read or hide 401.
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deps.invalidateSession(),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, Math.max(0, deadlineAt - clock()));
          }),
        ]);
      } catch {
        /* The response remains unauthorized. */
      } finally {
        clearTimeout(cleanupTimer);
      }
      throw new Stop("unauthorized", "n3_session_expired");
    }
    return out;
  }
  try {
    if (
      (mode === "external_matching"
        ? !["owner", "front_desk"].includes(actor.role)
        : actor.role !== "owner") ||
      !actor.n3Token?.trim() ||
      !actor.n3UserKey?.trim() ||
      !isUuid(actor.tenantId) ||
      !isUuid(actor.reservationId) ||
      !isUuid(intentId)
    )
      throw new Stop("needs_review", "settlement_forbidden");
    await authorize();
    const intent = await run(() => deps.loadIntent(actor));
    if (!intent || intent.id !== intentId || !persistedIntentBoundTo(intent, actor))
      throw new Stop("needs_review", "settlement_scope_mismatch");
    async function currentFacts() {
      if (!deps.snapshot)
        throw new Stop("needs_review", "n3_settlement_master_contract_unverified");
      const fresh = await run(() => deps.snapshot!(actor, intent!.snapshot));
      if (fresh.kind !== "confirmed") throw new Stop("needs_review", safeCode(fresh.code));
      if (billingPayloadDigest(fresh.value) !== billingPayloadDigest(intent!.snapshot))
        throw new Stop("needs_review", "settlement_snapshot_changed");
    }
    if (mode === "external_matching") await currentFacts();
    let firstMatch: ExternalMatchProof | null = null;
    let finalMatch: ExternalMatchProof | null = null;
    result.attempts = intent.dispatches.map((d) => ({
      attemptId: d.claim.attemptId,
      operation: d.claim.kind,
      code: safeCode(d.outcome?.code),
    }));
    const selected = targets(actor, intent, (t) => {
      const codes = (intent.evidence ?? []).flatMap((e) => {
        const doc = t.kind === "bill" ? e.bill : e.receipt;
        if (
          !plain(doc) ||
          (t.kind === "bill" ? doc.id : doc.receiptId) !== t.id ||
          typeof doc.code !== "string" ||
          !/^[\w ./-]{1,80}$/.test(doc.code)
        )
          return [];
        return [doc.code];
      });
      result.documents.push({
        id: t.id,
        code: new Set(codes).size === 1 ? codes[0] : t.id,
        kind: t.kind,
      });
    });
    const client = deps.client ?? n3BillingClient;
    for (let observation = 0; observation < 3; observation++) {
      if (observation)
        await run(() => deps.wait(observation === 1 ? 1000 : 2000, controller.signal));
      result.observations++;
      let missing = false,
        outstanding: number | null = null;
      const observed: SavedDocumentCheck["documents"] = [];
      let observedBill: VerifiedBill | null = null;
      const observedReceipts: VerifiedReceiptBefore[] = [];
      for (const t of selected) {
        const detail = await read(t.id, "detail", () =>
          t.kind === "bill"
            ? client.readBill(actor, t.id, limit)
            : client.readReceipt(actor, t.id, limit),
        );
        const journal = await read(t.id, "journal", () =>
          t.kind === "bill"
            ? client.readBillJournal(actor, t.id, limit)
            : client.readReceiptJournal(actor, t.id, limit),
        );
        if (absent(detail) || absent(journal)) {
          missing = true;
          continue;
        }
        const proof =
          t.kind === "bill"
            ? proveBill(intent.snapshot, detail, journal, actor, {
                intentId: intent.id,
                billId: t.id,
              })
            : proveReceiptBefore(intent.snapshot, t.receipt!, detail, journal, actor);
        if (proof.kind !== "confirmed") {
          if (proof.kind === "unavailable" && proof.code === "n3_evidence_unavailable") {
            missing = true;
            continue;
          }
          throw new Stop("needs_review", safeCode(proof.code));
        }
        observed.push({ id: t.id, code: proof.value.code, kind: t.kind });
        if ("outstandingCents" in proof.value) {
          outstanding = proof.value.outstandingCents;
          observedBill = proof.value;
        } else observedReceipts.push(proof.value);
      }
      await authorize();
      if (!missing) {
        // The durable action may still be unknown. A diagnostic GET never changes it.
        if (intent.dispatches.some((d) => !d.outcome || d.outcome.kind === "unknown"))
          throw new Stop("waiting", "settlement_pending_financial_operation");
        if (mode === "external_matching") {
          if (!observedBill) throw new Stop("needs_review", "settlement_bill_identity_unavailable");
          const matched = proveExternalMatching(actor, intent, {
            bill: observedBill,
            receipts: observedReceipts,
          });
          if (matched.kind !== "confirmed") throw new Stop("needs_review", safeCode(matched.code));
          if (!firstMatch) {
            firstMatch = matched.value;
            // A second complete observation is mandatory; a later retry cannot
            // silently discard a contradictory first observation.
            continue;
          }
          if (firstMatch.observationDigest !== matched.value.observationDigest)
            throw new Stop("needs_review", "settlement_evidence_changed");
          await currentFacts();
          const current = await run(() => deps.loadIntent(actor));
          if (
            !current ||
            !persistedIntentBoundTo(current, actor) ||
            billingPayloadDigest(current) !== billingPayloadDigest(intent)
          )
            throw new Stop("needs_review", "settlement_stale_revision");
          await authorize();
          finalMatch = firstMatch;
        }
        result.status = "confirmed";
        result.code =
          mode === "external_matching"
            ? "external_matching_observed"
            : "saved_document_observations_confirmed";
        if (finalMatch) {
          result.externalMatching = {
            provenance: "external_n3_matching",
            canClose: false,
            matches: finalMatch.matches.map((m) => ({ ...m })),
            receiptObservations: finalMatch.receiptObservations.map((r) => ({ ...r })),
          };
          externalChecks.set(result, {
            actor: { ...actor },
            intent,
            proof: finalMatch,
            resultHash: "",
          });
        }
        result.documents = observed;
        result.billOutstandingCents = outstanding;
        break;
      }
      result.status = "waiting";
      result.code = "verification_waiting";
    }
  } catch (error) {
    result.status = error instanceof Stop ? error.status : "needs_review";
    result.code = error instanceof Stop ? error.code : "settlement_unavailable";
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
  if (result.status !== "confirmed") result.billOutstandingCents = null;
  const external = externalChecks.get(result);
  result.checkedAt = external?.proof.checkedAt ?? new Date(clock()).toISOString();
  result.checks = names.map((name) => ({
    name,
    status: result.status === "confirmed" ? "observed" : "unavailable",
    code: result.code,
  }));
  if (external) external.resultHash = billingPayloadDigest(result);
  return result;
}
