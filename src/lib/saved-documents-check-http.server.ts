import type { SettlementActor } from "./settlement-context.server";
import type {
  SavedDocumentCheck,
  SavedDocumentSelection,
  SourceMatchingBinding,
} from "./saved-documents-check";
import { isUuid } from "./reservations-store.server";
export type SavedCheckHttpDeps = {
  actor(): Promise<SettlementActor | null>;
  selection?(actor: SettlementActor): Promise<SavedDocumentSelection>;
  exists(actor: SettlementActor): Promise<boolean>;
  check(
    actor: SettlementActor,
    intentId: string,
    signal: AbortSignal,
    deadlineAt: number,
    source?: SourceMatchingBinding,
  ): Promise<SavedDocumentCheck>;
};
const deny = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
export async function handleSavedDocumentCheckHttp(
  request: Request,
  id: string,
  deps: SavedCheckHttpDeps,
  mode: "documents" | "external_matching" = "documents",
): Promise<Response> {
  const controller = new AbortController(),
    deadlineAt = Date.now() + 40_000;
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 40_000);
  async function bounded<T>(work: () => Promise<T>) {
    if (controller.signal.aborted) throw new Error("cancelled");
    let listener: (() => void) | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_r, reject) => {
          listener = () => reject(new Error("cancelled"));
          controller.signal.addEventListener("abort", listener, { once: true });
        }),
      ]);
    } finally {
      if (listener) controller.signal.removeEventListener("abort", listener);
    }
  }
  try {
    if (request.method !== "POST" && request.method !== "GET")
      return deny(405, "method_not_allowed");
    if (request.method === "POST") {
      const site = request.headers.get("sec-fetch-site"),
        origin = request.headers.get("origin");
      if (site && site !== "same-origin") return deny(403, "cross_site_denied");
      let sameOrigin = site === "same-origin";
      if (origin) {
        try {
          sameOrigin = new URL(origin).origin === new URL(request.url).origin;
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) return deny(403, "cross_site_denied");
      if (
        request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      )
        return deny(415, "unsupported_media_type");
    }
    const source = await bounded(() => deps.actor());
    if (!source) return deny(401, "unauthenticated");
    if (
      mode === "external_matching"
        ? !["owner", "front_desk"].includes(source.role)
        : source.role !== "owner"
    )
      return deny(403, "forbidden");
    if (!isUuid(id)) return deny(400, "invalid_id");
    const actor = { ...source, reservationId: id };
    if (!(await bounded(() => deps.exists(actor)))) return deny(404, "reservation_not_found");
    if (request.method === "GET") {
      if (!deps.selection) return deny(503, "saved_check_unavailable");
      const selection = await bounded(() => deps.selection!(actor));
      if (selection.tenantId !== actor.tenantId || selection.reservationId !== id)
        return deny(503, "saved_check_scope_mismatch");
      return Response.json(selection, { headers: { "cache-control": "no-store" } });
    }
    const reader = request.body?.getReader();
    if (!reader) return deny(400, "invalid_input");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await bounded(() => reader.read());
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4096) {
          void reader.cancel().catch(() => {});
          return deny(400, "invalid_input");
        }
        chunks.push(part.value);
      }
    } finally {
      if (controller.signal.aborted) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return deny(400, "invalid_input");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      ![1, 2].includes(Object.keys(body).length) ||
      !("intentId" in body) ||
      !isUuid(body.intentId)
    )
      return deny(400, "invalid_input");
    let selection: SourceMatchingBinding | undefined;
    if (Object.keys(body).length === 2) {
      const value = "source" in body ? body.source : null;
      if (
        mode !== "external_matching" ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== 3 ||
        !("legId" in value) ||
        !("planDigest" in value) ||
        !("expectedRevision" in value) ||
        value.legId !== body.intentId ||
        !isUuid(value.legId) ||
        typeof value.planDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.planDigest) ||
        typeof value.expectedRevision !== "string" ||
        !/^(0|[1-9]\d{0,18})$/.test(value.expectedRevision) ||
        BigInt(value.expectedRevision) > 9223372036854775807n
      )
        return deny(400, "invalid_input");
      selection = value as SourceMatchingBinding;
    }
    // Transfer the shared deadline to the runner: it cancels reads and returns
    // its safe waiting packet. A competing HTTP timer would discard that packet.
    clearTimeout(timer);
    const result = selection
      ? await deps.check(actor, body.intentId as string, controller.signal, deadlineAt, selection)
      : await deps.check(actor, body.intentId as string, controller.signal, deadlineAt);
    if (
      result.tenantId !== actor.tenantId ||
      result.reservationId !== id ||
      result.intentId !== body.intentId
    )
      return deny(503, "saved_check_scope_mismatch");
    if (result.status === "unauthorized") return deny(401, "n3_session_expired");
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(503, "saved_check_unavailable");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
