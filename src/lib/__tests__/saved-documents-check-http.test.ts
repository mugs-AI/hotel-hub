import { describe, expect, it, vi } from "vitest";
import {
  handleSavedDocumentCheckHttp,
  type SavedCheckHttpDeps,
} from "../saved-documents-check-http.server";
import { fixtureActor as actor, fixtureIntentId as intentId } from "./fixtures/settlement-evidence";
import type { SavedDocumentCheck } from "../saved-documents-check";
const base: SavedDocumentCheck = {
  tenantId: actor.tenantId,
  reservationId: actor.reservationId,
  intentId,
  status: "waiting",
  code: "verification_waiting",
  checkedAt: "2026-10-12T04:00:00Z",
  observations: 3,
  persistenceProven: false,
  billOutstandingCents: null,
  documents: [],
  attempts: [],
  responses: [],
  checks: [],
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://synthetic.test/check", {
    method: "POST",
    headers: { origin: "https://synthetic.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
function setup() {
  return {
    actor: vi.fn(async () => actor),
    exists: vi.fn(async () => true),
    check: vi.fn(async () => base),
  } satisfies SavedCheckHttpDeps;
}
describe("Owner saved-document endpoint", () => {
  it("booking_selection_GET_reads_stored_metadata_without_N3_check", async () => {
    const d = {
      ...setup(),
      selection: vi.fn(async () => ({
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        intentId,
        currency: "MYR",
      })),
    };
    const r = await handleSavedDocumentCheckHttp(
      new Request("https://synthetic.test/check"),
      actor.reservationId,
      d,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ intentId, currency: "MYR" });
    expect(d.check).not.toHaveBeenCalled();
    expect(d.selection).toHaveBeenCalledTimes(1);
  });
  it("browser_url_or_unowned_id_ignored_by_rejecting_extra_input", async () => {
    for (const key of ["url", "documentId", "tenantId", "n3Token", "role"]) {
      const d = setup();
      const r = await handleSavedDocumentCheckHttp(
        request({ intentId, [key]: "injected" }),
        actor.reservationId,
        d,
      );
      expect(r.status).toBe(400);
      expect(d.check).not.toHaveBeenCalled();
    }
  });
  it.each(["front_desk", "housekeeper"] as const)("denies %s before money reads", async (role) => {
    const d = setup();
    d.actor.mockResolvedValue({ ...actor, role });
    expect(
      (await handleSavedDocumentCheckHttp(request({ intentId }), actor.reservationId, d)).status,
    ).toBe(403);
    expect(d.check).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and non-JSON requests", async () => {
    for (const [headers, status] of [
      [{ origin: "https://alien.test" }, 403],
      [{ "content-type": "text/plain" }, 415],
    ] as const) {
      const d = setup();
      expect(
        (await handleSavedDocumentCheckHttp(request({ intentId }, headers), actor.reservationId, d))
          .status,
      ).toBe(status);
      expect(d.actor).not.toHaveBeenCalled();
    }
  });
  it("foreign reservation returns404 without service", async () => {
    const d = setup();
    d.exists.mockResolvedValue(false);
    expect(
      (await handleSavedDocumentCheckHttp(request({ intentId }), actor.reservationId, d)).status,
    ).toBe(404);
    expect(d.check).not.toHaveBeenCalled();
  });
  it("returns scoped read-only observations with no-store", async () => {
    const d = setup(),
      r = await handleSavedDocumentCheckHttp(request({ intentId }), actor.reservationId, d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(base);
    expect(d.check).toHaveBeenCalledWith(
      actor,
      intentId,
      expect.any(AbortSignal),
      expect.any(Number),
    );
  });
  it("401_and_scope_mismatch_never_return_stale_money", async () => {
    for (const changed of [
      { status: "unauthorized" as const, code: "n3_session_expired" },
      { tenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ]) {
      const d = setup();
      d.check.mockResolvedValue({ ...base, billOutstandingCents: 50000, ...changed });
      const r = await handleSavedDocumentCheckHttp(request({ intentId }), actor.reservationId, d);
      expect(r.status).toBe(changed.status ? 401 : 503);
      expect(await r.text()).not.toContain("50000");
    }
  });
  it("request_body_is_stream_capped", async () => {
    const d = setup();
    const r = await handleSavedDocumentCheckHttp(
      request({ intentId, padding: "x".repeat(4096) }),
      actor.reservationId,
      d,
    );
    expect(r.status).toBe(400);
    expect(d.check).not.toHaveBeenCalled();
  });
});
