import { liveSettlementDeps, liveSettlementHttpDeps } from "./settlement-adapter.server";
import { checkSavedDocuments } from "./saved-documents-check.server";
import type { SavedCheckHttpDeps } from "./saved-documents-check-http.server";
import { readRequestContext, destroySession } from "./session-context.server";
export function liveSavedCheckHttpDeps(): SavedCheckHttpDeps {
  const auth = liveSettlementHttpDeps(),
    deps = liveSettlementDeps();
  return {
    actor: auth.actor,
    exists: auth.exists,
    async selection(actor) {
      const intent = await deps.store.read(actor);
      return {
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        intentId: intent?.id ?? null,
        currency: intent?.snapshot.currency ?? "",
      };
    },
    check: (actor, intentId, signal, deadlineAt) =>
      checkSavedDocuments(actor, intentId, {
        loadIntent: (a) => deps.store.read(a),
        now: Date.now,
        signal,
        deadlineAt,
        async authorize(a) {
          const ctx = await readRequestContext();
          return Boolean(
            ctx.authenticated &&
            ctx.role === "owner" &&
            ctx.session.tenantId === a.tenantId &&
            ctx.session.n3UserKey === a.n3UserKey &&
            ctx.session.n3Token === a.n3Token,
          );
        },
        invalidateSession: () => destroySession("n3_unauthorized"),
        wait: (ms, s) =>
          new Promise<void>((resolve, reject) => {
            if (s.aborted) {
              reject(new Error("cancelled"));
              return;
            }
            const aborted = () => {
              clearTimeout(timer);
              reject(new Error("cancelled"));
            };
            const timer = setTimeout(() => {
              s.removeEventListener("abort", aborted);
              resolve();
            }, ms);
            s.addEventListener("abort", aborted, { once: true });
          }),
      }),
  };
}
