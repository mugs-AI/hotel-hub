import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAccountantCaseStore, accountantCaseBinding } from "../accountant-cases-store.server";
import type { AccountantCaseRow } from "../accountant-cases";
import type { SettlementRpc } from "../settlement-store.server";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
const caseId = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222";
const row = (): AccountantCaseRow => ({
  caseId,
  version: "1",
  key: {
    reservationId: actor.reservationId,
    intentId: "44444444-4444-4444-8444-444444444444",
    kind: "receipt_surplus",
    documentIds: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
  },
  bookingReference: "SYNTHETIC",
  stayFrom: "2026-10-01",
  stayTo: "2026-10-02",
  documentReferences: [
    { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", code: "", date: "2026-10-01" },
  ],
  currency: "MYR",
  firstSeen: "2026-10-01T03:00:00.000Z",
  lastChecked: null,
  status: "open",
  observation: {
    available: false,
    checkedAt: "2026-10-01T03:00:00.000Z",
    evidenceDigest: null,
    observedAmountCents: null,
    outcomeCode: "unknown",
  },
  nextAction: "Check N3 result",
  notes: [],
});
function setup(data: unknown = row(), error: null | { code?: string; message?: string } = null) {
  const rpc = vi
    .fn<SettlementRpc>()
    .mockImplementation(async () => ({ data: structuredClone(data), error }));
  return { rpc, store: createAccountantCaseStore(rpc) };
}
describe("scoped accountant case store", () => {
  it("committed_resolution_replays_without_new_process_local_authority", async () => {
    const resolved = { ...row(), version: "2", status: "resolved" };
    const rpc = vi.fn<SettlementRpc>().mockResolvedValue({ data: resolved, error: null });
    const store = createAccountantCaseStore(rpc);
    const result = await store.append(
      actor,
      caseId,
      "1",
      {
        kind: "resolve",
        reason: "Synthetic verified result",
        observation: {
          available: true,
          checkedAt: "2026-10-01T03:00:00.000Z",
          evidenceDigest: "a".repeat(64),
          observedAmountCents: 0,
          outcomeCode: "verified",
        },
        proofDigest: "b".repeat(64),
      },
      requestId,
    );
    expect(result.status).toBe("resolved");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["hotelhub_accountant_case_event_replay"]);
  });
  it("unexpected_private_observation_fields_are_not_serialized", async () => {
    const r = row();
    Object.assign(r.observation, { n3Token: actor.n3Token });
    const f = setup(r);
    const got = await f.store.readCase(actor, caseId);
    expect(JSON.stringify(got)).not.toContain(actor.n3Token);
  });
  it("owner_only_before_any_rpc", async () => {
    const f = setup();
    await expect(
      f.store.ensureOpen({ ...actor, role: "front_desk" }, row().key, row().observation, requestId),
    ).rejects.toThrow("accountant_forbidden");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("opening_case_sends_scope_not_credentials", async () => {
    const f = setup();
    const value = await f.store.ensureOpen(actor, row().key, row().observation, requestId);
    expect(value.caseId).toBe(caseId);
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(actor.n3Token);
    expect(f.rpc.mock.calls[0][0]).toBe("hotelhub_accountant_case_open");
  });
  it("missing_schema_is_setup_required", async () => {
    const f = setup(null, { code: "42883" });
    await expect(f.store.readCase(actor, caseId)).rejects.toThrow("accountant_setup_required");
  });
  it("alien_case_and_result_key_rejected", async () => {
    const f = setup({
      ...row(),
      key: { ...row().key, reservationId: "99999999-9999-4999-8999-999999999999" },
    });
    await expect(
      f.store.ensureOpen(actor, row().key, row().observation, requestId),
    ).rejects.toThrow("accountant_scope_mismatch");
  });
  it("untrusted_body_proof_cannot_resolve", async () => {
    const f = setup(null);
    await expect(
      f.store.append(
        actor,
        caseId,
        "1",
        {
          kind: "resolve",
          reason: "Synthetic",
          observation: {
            ...row().observation,
            available: true,
            evidenceDigest: "a".repeat(64),
            observedAmountCents: 0,
          },
          proofDigest: "a".repeat(64),
        },
        requestId,
      ),
    ).rejects.toThrow("accountant_resolution_unverified");
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual(["hotelhub_accountant_case_event_replay"]);
  });
  it("read_only_page_creates_no_events_and_keeps_null", async () => {
    const f = setup({
      rows: [row()],
      asAt: "2026-10-12",
      generatedAt: new Date().toISOString(),
      complete: true,
      nextOffset: null,
    });
    const page = await f.store.read(actor, {
      asAt: "2026-10-12",
      status: "open",
      offset: 0,
      limit: 20,
    });
    expect(page.rows[0].observation.observedAmountCents).toBeNull();
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual(["hotelhub_accountant_cases_read"]);
  });
  it("current_case_binding_is_private_and_session_bound", async () => {
    const f = setup();
    const got = await f.store.readCase(actor, caseId);
    expect(accountantCaseBinding(got, actor)?.version).toBe("1");
    expect(accountantCaseBinding(structuredClone(got), actor)).toBeNull();
    expect(accountantCaseBinding(got, { ...actor, n3Token: "other" })).toBeNull();
    expect(accountantCaseBinding(got, { ...actor, role: "front_desk" })).toBeNull();
    expect(Object.isFrozen(got.key.documentIds)).toBe(true);
  });
  it("saved_statement_digest_verifies_exact_bytes_and_readback_is_read_only", async () => {
    const page = {
      rows: [row()],
      asAt: "2026-10-12",
      generatedAt: new Date().toISOString(),
      complete: true,
      nextOffset: null,
    };
    const pageText = JSON.stringify(page),
      digest = createHash("sha256").update(pageText).digest("hex");
    const f = setup({ statementId: caseId, digest, pageText });
    const saved = await f.store.saveStatement(
      actor,
      { asAt: "2026-10-12", status: "open" },
      requestId,
    );
    const read = await f.store.readStatement(actor, caseId);
    expect(read).toEqual(saved);
    expect(read.digest).toBe(digest);
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
      "hotelhub_accountant_statement",
      "hotelhub_accountant_statement_read",
    ]);
    const bad = setup({ statementId: caseId, digest: "a".repeat(64), pageText });
    await expect(bad.store.readStatement(actor, caseId)).rejects.toThrow(
      "accountant_statement_unverified",
    );
  });
  it("malformed_or_partial_statement_is_never_complete", async () => {
    const pageText = JSON.stringify({
      rows: [row()],
      asAt: "2026-10-12",
      generatedAt: new Date().toISOString(),
      complete: false,
      nextOffset: 20,
    });
    const f = setup({
      statementId: caseId,
      digest: createHash("sha256").update(pageText).digest("hex"),
      pageText,
    });
    await expect(f.store.readStatement(actor, caseId)).rejects.toThrow();
  });
});
