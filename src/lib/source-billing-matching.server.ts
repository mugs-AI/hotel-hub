import type { SettlementActor } from "./settlement-context.server";
import type { SourceMatchingBinding } from "./saved-documents-check";
import type { SavedCheckDeps } from "./saved-documents-check.server";
import type { SourceBillingDeps } from "./source-billing-coordinator.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { hasPermission } from "./rbac";

/** Select the saved guest leg, never a browser-supplied N3 document or the
 * legacy single-bill intent. Recheck the binding throughout the bounded reader. */
export async function bindSourceMatchingCheck(
  actor: SettlementActor,
  selection: SourceMatchingBinding,
  billing: SourceBillingDeps,
  base: SavedCheckDeps,
): Promise<SavedCheckDeps> {
  if (
    !hasPermission(actor.role, "hotel:checkout:write") ||
    !actor.n3Token?.trim() ||
    !actor.n3UserKey?.trim()
  )
    throw Error("settlement_forbidden");
  const bound = Object.freeze({ ...actor }),
    input = Object.freeze({ ...selection });
  const deadline = base.deadlineAt ?? base.now() + 40000;
  function live() {
    if (base.signal?.aborted || base.now() >= deadline) throw Error("cancelled");
  }
  async function bounded<T>(work: () => Promise<T>): Promise<T> {
    live();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const value = await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(Error("cancelled"));
          base.signal?.addEventListener("abort", abort, { once: true });
          timer = setTimeout(abort, Math.max(0, deadline - base.now()));
          if (base.signal?.aborted) abort();
        }),
      ]);
      live();
      return value;
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) base.signal?.removeEventListener("abort", abort);
    }
  }
  function sameActor(current: SettlementActor) {
    if (
      ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"].some(
        (k) => current[k as keyof SettlementActor] !== bound[k as keyof SettlementActor],
      )
    )
      throw Error("settlement_scope_mismatch");
  }
  async function readLeg(current: SettlementActor) {
    sameActor(current);
    const stay = await bounded(() => billing.store.read(bound));
    if (!stay || stay.plan.digest !== input.planDigest) throw Error("settlement_scope_mismatch");
    const leg = stay.legs.find((l) => l.legId === input.legId);
    if (!leg || leg.id !== input.legId || leg.legKind !== "guest")
      throw Error("source_billing_guest_action_required");
    if (leg.revision !== input.expectedRevision) throw Error("settlement_stale_revision");
    return leg;
  }
  const saved = await readLeg(bound);
  const scoped = await bounded(() => billing.store.forLeg(bound, input.legId, input.planDigest));
  const own = await bounded(() =>
    billing.legDeps(bound, saved, {
      signal: base.signal ?? new AbortController().signal,
      deadlineAt: deadline,
      budget: { remainingBytes: 2000000 },
      authorize: base.authorize,
    }),
  );
  return {
    ...base,
    async loadIntent(current) {
      const leg = await readLeg(current);
      if (billingPayloadDigest(leg.snapshot) !== billingPayloadDigest(saved.snapshot))
        throw Error("settlement_snapshot_changed");
      const intent = await bounded(() => scoped.read(current));
      if (
        !intent ||
        intent.id !== input.legId ||
        intent.revision !== input.expectedRevision ||
        billingPayloadDigest(intent.snapshot) !== billingPayloadDigest(saved.snapshot)
      )
        throw Error("settlement_stale_revision");
      return intent;
    },
    async snapshot(current, frozen) {
      await readLeg(current);
      if (billingPayloadDigest(frozen) !== billingPayloadDigest(saved.snapshot))
        return { kind: "contradiction", code: "settlement_snapshot_changed" };
      return bounded(() => own.snapshot(current, frozen));
    },
  };
}
