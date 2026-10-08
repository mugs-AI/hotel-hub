/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Service-level tests with an in-memory DB double that mirrors the staged SQL
// transaction functions (the real SQL is exercised separately with PGlite in
// db/migrations-pending/checks). No N3 or database calls.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createReceiptControlRequest,
  decideReceiptControlRequest,
  listReceiptControlRequests,
  mapDbError,
  readReceiptOriginalForDialog,
  type ReceiptControlDb,
  type RequestRow,
  type StoreDeps,
} from "../receipt-controls-store.server";
import {
  executeReceiptControlRequest,
  recoverReceiptControlRequest,
  RECEIPT_VERIFY_STALE_SECONDS,
  verifyReceiptControlRequest,
} from "../receipt-controls-execution.server";
import { loadReceiptOverlay } from "../effective-receipts.server";
import { deliverReceiptAlerts } from "../receipt-alert-delivery.server";
import { statusForReceiptControlError } from "../receipt-controls-http.server";
import {
  MANUAL_APPROVAL_MESSAGE,
  ReceiptControlError,
  type ReceiptSnapshot,
} from "../receipt-controls";
import { receiptSnapshot } from "./fixtures/receipt-controls";
import { ReceiptRequestCard } from "../../components/ReceiptApprovalQueue";
import { receiptAlertLabel } from "../../components/ReceiptAlertStatus";
import {
  provisionalDeltaLines,
  parseAmountInput,
  buildCorrectionProposal,
  contactDraftFromOriginal,
} from "../../components/ReceiptControlRequestDialog";
import { requiresAccountEligibility, validateReceiptControlProposal } from "../receipt-controls";
import {
  invalidateReceiptEffects,
  listAllReceiptControls,
  purgeForeignReceiptCache,
  receiptIdentityKey,
  RECEIPT_EFFECT_QUERY_PREFIXES,
} from "../receipt-controls-client";
import { readFileSync } from "node:fs";

const RES = "44444444-4444-4444-8444-444444444444";
const DEP = "55555555-5555-4555-8555-555555555555";
const KEY = "66666666-6666-4666-8666-666666666666";
const ACC = "33333333-3333-4333-8333-333333333333";
const CUST = "22222222-2222-4222-8222-222222222222";
const owner = { tenantId: "t1", n3UserKey: "owner-1", n3Token: "tok", role: "owner" as const };
const fd = { tenantId: "t1", n3UserKey: "fd-1", n3Token: "tok", role: "front_desk" as const };
const hk = { tenantId: "t1", n3UserKey: "hk-1", n3Token: "tok", role: "housekeeper" as const };

function memoryDb() {
  const rows = new Map<string, RequestRow>();
  const decisions: any[] = [];
  const versions: any[] = [];
  const alerts: any[] = [];
  const claims = new Map<string, string>();
  const claimedAt = new Map<string, number>();
  const clock = { now: 0 };
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const active = ["pending", "approved_awaiting_n3", "applying", "failed", "needs_review"];
  const db: ReceiptControlDb = {
    async create(a) {
      const existing = [...rows.values()].find((r) => r.clientRequestId === a.clientRequestId);
      if (existing) {
        if (existing.fingerprint !== a.fingerprint)
          throw new ReceiptControlError("receipt_control_key_conflict");
        return existing;
      }
      if ([...rows.values()].some((r) => r.depositId === a.depositId && active.includes(r.state)))
        throw new ReceiptControlError("receipt_control_active_exists");
      const row: RequestRow = {
        id: id(),
        tenantId: a.tenantId,
        reservationId: a.reservationId,
        depositId: a.depositId,
        clientRequestId: a.clientRequestId,
        fingerprint: a.fingerprint,
        kind: a.kind,
        reason: a.reason,
        original: a.original,
        proposal: a.proposal,
        comparison: a.comparison,
        executionMode: "manual",
        state: "pending",
        version: 1,
        requestedBy: a.actor,
        requestedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        approvedBy: null,
        approvedAt: null,
        outcomeCode: null,
      };
      rows.set(row.id, row);
      alerts.push({
        requestId: row.id,
        event: "pending",
        requestVersion: 1,
        status: "pending",
        lastErrorCode: null,
        createdAt: "1",
      });
      return row;
    },
    async decide(a) {
      const r = rows.get(a.requestId)!;
      if (r.version !== a.expectedVersion) throw new ReceiptControlError("version_conflict");
      // Mirrors staged SQL: an in-flight claim fences every decision.
      if (claims.has(r.id)) throw new ReceiptControlError("claim_conflict");
      const ok =
        (a.decision === "approve" && r.state === "pending") ||
        (a.decision === "hold" && ["pending", "approved_awaiting_n3"].includes(r.state)) ||
        (a.decision === "reject" && ["pending", "needs_review"].includes(r.state));
      if (!ok) throw new ReceiptControlError("invalid_transition");
      decisions.push({
        requestId: r.id,
        decision: a.decision,
        actor: a.actor,
        selfApproved: a.actor === r.requestedBy,
        createdAt: "1",
      });
      const next = {
        ...r,
        state: a.toState,
        version: r.version + 1,
        outcomeCode: a.outcomeCode,
        decidedBy: a.decision === "hold" ? r.decidedBy : a.actor,
        approvedBy: a.decision === "approve" ? a.actor : r.approvedBy,
        approvedAt: a.decision === "approve" ? "now" : r.approvedAt,
      };
      rows.set(r.id, next);
      return next;
    },
    async claim(a) {
      const r = rows.get(a.requestId)!;
      if (!r.approvedAt) throw new ReceiptControlError("not_approved");
      if (
        r.version !== a.expectedVersion ||
        !["approved_awaiting_n3", "needs_review"].includes(r.state)
      )
        return null;
      if (claims.has(r.id)) return null;
      const c = id();
      claims.set(r.id, c);
      claimedAt.set(r.id, clock.now);
      rows.set(r.id, {
        ...r,
        state: r.state === "approved_awaiting_n3" ? "applying" : r.state,
        version: r.version + 1,
      });
      return c;
    },
    async complete(a) {
      const r = rows.get(a.requestId)!;
      if (claims.get(r.id) !== a.executionId) throw new ReceiptControlError("claim_not_found");
      claims.delete(r.id);
      if (!r.approvedAt || !["applying", "needs_review"].includes(r.state))
        throw new ReceiptControlError("claim_stale");
      if (
        (a.toState === "applied" && !a.version) ||
        (a.toState !== "applied" && a.version && a.version.state !== "voided")
      )
        throw new ReceiptControlError("invalid_transition");
      if (a.version) versions.push({ depositId: r.depositId, ...a.version });
      const next = { ...r, state: a.toState, version: r.version + 1, outcomeCode: a.outcomeCode };
      rows.set(r.id, next);
      return next;
    },
    async verifyAtomic(a) {
      // Mirrors staged SQL: claim + complete in one transaction.
      const c = await db.claim({ ...a, step: "verify" });
      if (!c) throw new ReceiptControlError("claim_conflict");
      return db.complete({ ...a, executionId: c });
    },
    async recover(a) {
      const r = rows.get(a.requestId)!;
      if (r.version !== a.expectedVersion) throw new ReceiptControlError("version_conflict");
      if (!["applying", "needs_review"].includes(r.state) || !r.approvedAt)
        throw new ReceiptControlError("invalid_transition");
      if (!claims.has(r.id)) throw new ReceiptControlError("claim_not_found");
      if (clock.now - claimedAt.get(r.id)! < a.staleSeconds * 1000)
        throw new ReceiptControlError("claim_conflict");
      claims.delete(r.id);
      decisions.push({
        requestId: r.id,
        decision: "recover",
        actor: a.actor,
        selfApproved: false,
        createdAt: "1",
      });
      const next = {
        ...r,
        state: r.state === "applying" ? ("approved_awaiting_n3" as const) : r.state,
        version: r.version + 1,
        outcomeCode: "verification_interrupted",
      };
      rows.set(r.id, next);
      return next;
    },
    async get(_t, rid) {
      return rows.get(rid) ?? null;
    },
    async list(_t, f) {
      const all = [...rows.values()].filter(
        (r) =>
          (!f.requestedBy || r.requestedBy === f.requestedBy) &&
          (!f.reservationId || r.reservationId === f.reservationId) &&
          (!f.states || f.states.includes(r.state)),
      );
      return { rows: all.slice(f.offset, f.offset + f.limit), total: all.length };
    },
    async decisions() {
      return decisions;
    },
    async alerts() {
      return alerts;
    },
  };
  return { db, rows, decisions, versions, claims, clock };
}

function deps(over: Partial<StoreDeps> & { evidence?: () => ReceiptSnapshot } = {}) {
  const mem = memoryDb();
  const audit = vi.fn(async () => {});
  const d: StoreDeps = {
    db: mem.db,
    readEvidence: vi.fn(async () => (over.evidence ? over.evidence() : receiptSnapshot())),
    resolveAccount: vi.fn(async () => "BANK-2 — Other Bank"),
    walkInCustomerId: vi.fn(async () => CUST),
    labels: async () =>
      new Map([
        ["fd-1", "Front Desk A"],
        ["owner-1", "Owner"],
      ]),
    bookingRefs: async () => new Map([[RES, "BK-TEST-1"]]),
    audit,
    ...over,
  };
  return { d, mem, audit };
}

const contact = {
  name: "Test Guest",
  address: "1 Test Street",
  phone: "0100000000",
  email: "guest@example.test",
};
const correction = (amount = 80, accountId = ACC) => ({
  reservationId: RES,
  depositId: DEP,
  clientRequestId: KEY,
  reason: "Keyed RM50 instead of RM80",
  proposal: { kind: "correction", amount, accountId, contact },
});

describe("create", () => {
  it("Front Desk request RM50→RM80 shows +RM30 deposits / −RM30 balance and changes nothing else", async () => {
    const { d, mem, audit } = deps();
    const dto = await createReceiptControlRequest(fd, correction(), d);
    expect(dto.state).toBe("pending");
    expect(dto.comparison.depositDeltaCents).toBe(3000);
    expect(dto.comparison.balanceDeltaCents).toBe(-3000);
    expect(dto.canApprove).toBe(false); // FD can never approve
    expect(mem.versions).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "hotel.receipt_control.requested" }),
    );
    const detail = (audit.mock.calls[0] as any)[0].detail;
    expect(JSON.stringify(detail)).not.toContain("RM50"); // ids/outcomes only
  });
  it("housekeeper is refused", async () => {
    const { d } = deps();
    await expect(createReceiptControlRequest(hk, correction(), d)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("mandatory reason", async () => {
    const { d } = deps();
    await expect(
      createReceiptControlRequest(fd, { ...correction(), reason: "  " }, d),
    ).rejects.toMatchObject({ code: "invalid_reason" });
  });
  it("replays the same client key and refuses the key with different content", async () => {
    const { d } = deps();
    const a = await createReceiptControlRequest(fd, correction(), d);
    const b = await createReceiptControlRequest(fd, correction(), d);
    expect(b.id).toBe(a.id);
    await expect(createReceiptControlRequest(fd, correction(90), d)).rejects.toMatchObject({
      code: "receipt_control_key_conflict",
    });
  });
  it("matched/refunded receipt cannot be requested", async () => {
    const { d } = deps({ evidence: () => receiptSnapshot({ matchingState: "matched" }) });
    await expect(createReceiptControlRequest(fd, correction(), d)).rejects.toMatchObject({
      code: "receipt_restricted",
    });
  });
  it("hidden/unverified new deposit account is refused; verified one shows its label", async () => {
    const other = "77777777-7777-4777-8777-777777777777";
    const bad = deps({ resolveAccount: async () => null });
    await expect(
      createReceiptControlRequest(fd, correction(80, other), bad.d),
    ).rejects.toMatchObject({ code: "account_not_allowed" });
    const ok = deps();
    const dto = await createReceiptControlRequest(fd, correction(80, other), ok.d);
    expect(dto.comparison.fields.find((f) => f.label === "Deposit to")?.requested).toBe(
      "BANK-2 — Other Bank",
    );
  });
  it("contact line over 100 UTF-16 units is refused, not truncated", async () => {
    const { d } = deps();
    await expect(
      createReceiptControlRequest(
        fd,
        {
          ...correction(),
          proposal: {
            kind: "correction",
            amount: 80,
            accountId: ACC,
            contact: { ...contact, email: "a".repeat(101) },
          },
        },
        d,
      ),
    ).rejects.toBeInstanceOf(ReceiptControlError);
  });
});

describe("decide", () => {
  it("Owner approval moves to approved-awaiting-N3 with the manual message and does not change totals", async () => {
    const { d, mem } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    const dto = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      d,
    );
    expect(dto.state).toBe("approved_awaiting_n3");
    expect(dto.outcomeMessage).toBe(MANUAL_APPROVAL_MESSAGE);
    expect(dto.selfApproved).toBe(false);
    expect(mem.versions).toHaveLength(0);
  });
  it("Front Desk cannot approve", async () => {
    const { d } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    await expect(
      decideReceiptControlRequest(
        fd,
        { requestId: req.id, expectedVersion: 1, decision: "approve" },
        d,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("Owner self-approval is allowed and flagged", async () => {
    const { d, audit } = deps();
    const req = await createReceiptControlRequest(owner, correction(), d);
    const dto = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      d,
    );
    expect(dto.selfApproved).toBe(true);
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ selfApproved: true }) }),
    );
  });
  it("N3 changed since request → held Needs review instead of approved", async () => {
    let fp = "fp-original";
    const { d } = deps({ evidence: () => receiptSnapshot({ sourceFingerprint: fp }) });
    const req = await createReceiptControlRequest(fd, correction(), d);
    fp = "fp-external-edit";
    const dto = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      d,
    );
    expect(dto.state).toBe("needs_review");
    expect(dto.canVerify).toBe(false);
  });
  it("walk-in mapping change holds approval", async () => {
    const { d } = deps({ walkInCustomerId: async () => "99999999-9999-4999-8999-999999999999" });
    const req = await createReceiptControlRequest(fd, correction(), d);
    const dto = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      d,
    );
    expect(dto.state).toBe("needs_review");
  });
  it("stale version is refused", async () => {
    const { d } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "reject" },
      d,
    );
    await expect(
      decideReceiptControlRequest(
        owner,
        { requestId: req.id, expectedVersion: 1, decision: "approve" },
        d,
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
  });
});

describe("list scope", () => {
  it("Front Desk sees only own requests; Owner sees all", async () => {
    const { d } = deps();
    await createReceiptControlRequest(owner, correction(), d);
    expect((await listReceiptControlRequests(fd, {}, d)).requests).toHaveLength(0);
    expect((await listReceiptControlRequests(owner, {}, d)).requests).toHaveLength(1);
  });
});

async function approved(evidence: () => ReceiptSnapshot, proposal = correction()) {
  let phase: "request" | "after" = "request";
  const ctx = deps({ evidence: () => (phase === "request" ? receiptSnapshot() : evidence()) });
  const req = await createReceiptControlRequest(fd, proposal, ctx.d);
  const ok = await decideReceiptControlRequest(
    owner,
    { requestId: req.id, expectedVersion: 1, decision: "approve" },
    ctx.d,
  );
  phase = "after";
  return { ...ctx, req: ok };
}

describe("execute + verify (manual mode)", () => {
  it("execute never writes and returns the manual instruction", async () => {
    const { d, req } = await approved(() => receiptSnapshot());
    const out = await executeReceiptControlRequest(owner, req.id, d);
    expect(out.message).toBe(MANUAL_APPROVAL_MESSAGE);
    await expect(
      executeReceiptControlRequest(owner, req.id, d, {
        directEdit: true,
        voidReplace: false,
        manual: true,
      }),
    ).rejects.toMatchObject({ code: "automation_unavailable" });
  });
  it("exact N3 readback applies and records one version", async () => {
    const after = receiptSnapshot({
      amountCents: 8000,
      paymentLines: [{ accountId: ACC, code: "BANK-T", savedName: "Test Bank", amountCents: 8000 }],
      sourceFingerprint: "fp-after",
    });
    const { d, req, mem } = await approved(() => after);
    const dto = await verifyReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: req.version },
      d,
    );
    expect(dto.state).toBe("applied");
    expect(mem.versions).toEqual([expect.objectContaining({ state: "active", amountCents: 8000 })]);
  });
  it("unchanged N3 receipt (change not made) holds Needs review, no version", async () => {
    const { d, req, mem } = await approved(() => receiptSnapshot());
    const dto = await verifyReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: req.version },
      d,
    );
    expect(dto.state).toBe("needs_review");
    expect(mem.versions).toHaveLength(0);
  });
  it("404 / unreadable receipt is never proof of void", async () => {
    let gone = false;
    const ctx = deps({
      evidence: () => {
        if (gone) throw new ReceiptControlError("n3_evidence_unavailable");
        return receiptSnapshot();
      },
    });
    const req = await createReceiptControlRequest(
      fd,
      { ...correction(), proposal: { kind: "void" } },
      ctx.d,
    );
    const ok = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      ctx.d,
    );
    gone = true;
    const dto = await verifyReceiptControlRequest(
      owner,
      { requestId: ok.id, expectedVersion: ok.version },
      ctx.d,
    );
    expect(dto.state).toBe("needs_review");
    expect(ctx.mem.versions).toHaveLength(0);
  });
  it("unknown cancellation state holds Needs review", async () => {
    const { d, req } = await approved(() => receiptSnapshot({ documentState: "unknown" }), {
      ...correction(),
      proposal: { kind: "void" },
    } as any);
    const dto = await verifyReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: req.version },
      d,
    );
    expect(dto.state).toBe("needs_review");
  });
  it("cancellation flag alone holds Needs review and records NO voided version", async () => {
    const { d, req, mem } = await approved(() => receiptSnapshot({ documentState: "voided" }), {
      ...correction(),
      proposal: { kind: "void" },
    } as any);
    const dto = await verifyReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: req.version },
      d,
    );
    expect(dto.state).toBe("needs_review");
    expect(mem.versions).toHaveLength(0);
  });
  it("expired N3 session changes nothing", async () => {
    const { d, req, mem } = await approved(() => {
      throw new ReceiptControlError("unauthorized");
    });
    await expect(
      verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect((await mem.db.get("t1", req.id))!.state).toBe("approved_awaiting_n3");
  });
  it("two simultaneous verifies: exactly one wins the claim (in-memory interleave)", async () => {
    const { d, req } = await approved(() => receiptSnapshot());
    const results = await Promise.allSettled([
      verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d),
      verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "claim_conflict" });
  });
  it("Front Desk cannot verify", async () => {
    const { d, req } = await approved(() => receiptSnapshot());
    await expect(
      verifyReceiptControlRequest(fd, { requestId: req.id, expectedVersion: req.version }, d),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("effective overlay loader", () => {
  it("is empty when the staged tables are not installed", async () => {
    const o = await loadReceiptOverlay("t1", ["d1"], {
      versions: async () => null,
      unresolved: async () => null,
    });
    expect(o.size).toBe(0);
  });
  it("fails closed on real read errors", async () => {
    await expect(
      loadReceiptOverlay("t1", ["d1"], {
        versions: async () => {
          throw new Error("boom");
        },
        unresolved: async () => [],
      }),
    ).rejects.toThrow();
  });
  it("confirmed void stays excluded while replacement failed (Needs review)", async () => {
    const o = await loadReceiptOverlay("t1", ["d1"], {
      versions: async () => [
        {
          depositId: "d1",
          requestId: "r",
          versionNo: 1,
          state: "voided",
          receiptId: "x",
          docCode: "OR",
          documentDate: "d",
          currency: "MYR",
          amountCents: 5000,
          paymentLines: [],
          replacementOf: null,
          verifiedAt: "t",
        },
      ],
      unresolved: async () => ["d1"],
    });
    expect(o.get("d1")).toEqual({
      confirmed: { state: "voided", verifiedAt: "t" },
      needsReview: true,
    });
  });
  it("complete may record CONFIRMED void evidence while the overall step fails", async () => {
    const mem = memoryDb();
    const req = await mem.db.create({
      tenantId: "t1",
      reservationId: "r1",
      depositId: "d1",
      clientRequestId: "k-void",
      fingerprint: "f".repeat(64),
      kind: "void",
      reason: "Duplicate",
      original: receiptSnapshot(),
      proposal: { kind: "void" },
      comparison: { fields: [], depositDeltaCents: -5000, balanceDeltaCents: 5000 },
      originalCents: 5000,
      proposedCents: null,
      actor: "fd",
    });
    const a = await mem.db.decide({
      tenantId: "t1",
      requestId: req.id,
      expectedVersion: 1,
      decision: "approve",
      toState: "approved_awaiting_n3",
      actor: "owner",
      outcomeCode: null,
      note: null,
    });
    const claim = await mem.db.claim({
      tenantId: "t1",
      requestId: req.id,
      expectedVersion: a.version,
      step: "verify",
      actor: "owner",
    });
    const voided = {
      state: "voided" as const,
      receiptId: "x",
      docCode: "OR",
      documentDate: "2026-10-01",
      currency: "MYR",
      amountCents: 5000,
      paymentLines: [],
      replacementOf: null,
      fingerprint: "f",
    };
    const done = await mem.db.complete({
      tenantId: "t1",
      requestId: req.id,
      executionId: claim!,
      toState: "failed",
      outcomeCode: "replacement_failed",
      actor: "owner",
      version: voided,
    });
    expect(done.state).toBe("failed");
    expect(mem.versions).toEqual([expect.objectContaining({ state: "voided" })]);
  });
});

describe("review blocker: verify requires an approval", () => {
  it("pending -> Hold -> Needs review can never verify into Applied", async () => {
    const mem = memoryDb();
    const req = await mem.db.create({
      tenantId: "t1",
      reservationId: "r1",
      depositId: "d1",
      clientRequestId: "k-hold",
      fingerprint: "f".repeat(64),
      kind: "void",
      reason: "Duplicate",
      original: receiptSnapshot(),
      proposal: { kind: "void" },
      comparison: { fields: [], depositDeltaCents: -5000, balanceDeltaCents: 5000 },
      originalCents: 5000,
      proposedCents: null,
      actor: "fd",
    });
    const held = await mem.db.decide({
      tenantId: "t1",
      requestId: req.id,
      expectedVersion: 1,
      decision: "hold",
      toState: "needs_review",
      actor: "owner",
      outcomeCode: "n3_changed_since_request",
      note: null,
    });
    const d = { ...deps().d, db: mem.db };
    await expect(
      verifyReceiptControlRequest(owner, { requestId: held.id, expectedVersion: held.version }, d),
    ).rejects.toMatchObject({ code: "not_approved" });
    await expect(
      mem.db.claim({
        tenantId: "t1",
        requestId: held.id,
        expectedVersion: held.version,
        step: "verify",
        actor: "owner",
      }),
    ).rejects.toMatchObject({ code: "not_approved" });
    expect((await mem.db.get("t1", held.id))!.state).toBe("needs_review");
    expect(mem.versions).toHaveLength(0);
  });
});

describe("db error mapping + http status", () => {
  it.each(["settlement_locked", "settlement_busy"])(
    "preserves %s as a 409 without exposing database text",
    (code) => {
      expect(mapDbError({ code: "P0001", message: code }).code).toBe(code);
      expect(statusForReceiptControlError(code)).toBe(409);
    },
  );
  it("maps missing staged objects to unavailable", () => {
    expect(mapDbError({ code: "42883", message: "function does not exist" }).code).toBe(
      "receipt_controls_unavailable",
    );
    expect(mapDbError({ message: "ERROR: version_conflict" }).code).toBe("version_conflict");
    expect(statusForReceiptControlError("receipt_controls_unavailable")).toBe(503);
    expect(statusForReceiptControlError("forbidden")).toBe(403);
  });
});

describe("alerts (transport disabled)", () => {
  it("claims and settles as disabled; never sends", async () => {
    const settle = vi.fn(async () => {});
    const out = await deliverReceiptAlerts("t1", {
      claim: async () => [
        { id: "a1", tenantId: "t1", requestId: "r1", event: "pending", claimToken: "tok-1" },
      ],
      settle,
    });
    expect(out).toEqual({ claimed: 1, sent: 0, disabled: 1 });
    expect(settle).toHaveBeenCalledWith(
      "t1",
      "a1",
      "tok-1",
      "disabled",
      "transport_not_configured",
    );
  });
  it("status copy states nothing was sent", () => {
    expect(receiptAlertLabel({ status: "disabled", lastError: null })).toContain("not sent");
  });
});

describe("UI rendering", () => {
  it("dialog shows +RM30 deposits and −RM30 provisional balance for RM50→RM80", () => {
    const l = provisionalDeltaLines(5000, 8000, "MYR");
    expect(l.deposits).toContain("+RM30.00");
    expect(l.balance).toContain("-RM30.00");
    expect(parseAmountInput("80.00")).toBe(80);
    expect(parseAmountInput("80.001")).toBeNull();
  });
  it("queue card renders Approve/Reject for a pending Owner view and the self-approval note", async () => {
    const { d } = deps();
    await createReceiptControlRequest(owner, correction(), d);
    const [dto] = (await listReceiptControlRequests(owner, {}, d)).requests;
    const html = renderToStaticMarkup(
      createElement(ReceiptRequestCard, { r: { ...dto!, selfApproved: true } }),
    );
    // Approve is hidden until Review is opened AND the comparison acknowledged.
    expect(html).not.toMatch(/>Approve</);
    expect(html).toContain("Reject");
    expect(html).toContain("Review");
    expect(html).toContain("audited");
    expect(html).toContain("Notification:");
  });
});

describe("frozen42f review fixes", () => {
  const amountOnly = (amount: number, accountId?: string) => ({
    reservationId: RES,
    depositId: DEP,
    clientRequestId: KEY,
    reason: "Amount keyed wrong",
    proposal: { kind: "correction", amount, ...(accountId ? { accountId } : {}) },
  });

  it("amount-only correction preserves the saved N3 bill-to name and remarks exactly", async () => {
    const { d, mem } = deps();
    const dto = await createReceiptControlRequest(fd, amountOnly(80), d);
    const row = [...mem.rows.values()][0]!;
    expect(row.proposal).toMatchObject({ kind: "correction", amountCents: 8000 });
    expect((row.proposal as any).contact).toEqual(receiptSnapshot().contact);
    expect((row.proposal as any).accountId).toBe(ACC);
    expect(dto.comparison.fields.map((f) => f.label)).toEqual(["Amount"]);
  });

  it("dialog proposal omits contact unless explicitly edited and changed", () => {
    const saved = contactDraftFromOriginal(receiptSnapshot().contact);
    expect(saved).toEqual({
      name: "Test Guest",
      address: "1 Test Street",
      phone: "0100000000",
      email: "guest@example.test",
    });
    const base = { amount: 80, accountId: ACC, draft: saved, saved };
    expect(buildCorrectionProposal({ ...base, editContact: false })).not.toHaveProperty("contact");
    expect(buildCorrectionProposal({ ...base, editContact: true })).not.toHaveProperty("contact");
    const edited = { ...saved, phone: "0111111111" };
    expect(
      buildCorrectionProposal({ ...base, editContact: false, draft: edited }),
    ).not.toHaveProperty("contact");
    expect(
      (buildCorrectionProposal({ ...base, editContact: true, draft: edited }) as any).contact,
    ).toEqual(edited);
    // Round-trip: prefilled draft re-formats to the identical saved contact.
    const v = validateReceiptControlProposal(
      {
        kind: "correction",
        amount: 50,
        accountId: ACC,
        contact: { ...saved, phone: "0111111111" },
      },
      receiptSnapshot(),
    );
    expect(v.kind === "correction" && v.contact.customerName).toBe("Test Guest");
    expect(v.kind === "correction" && v.contact.remark1).toBe("1 Test Street");
  });

  it("account policy: contact-only keeps a disabled historical account; money/account change re-verifies even the same id", async () => {
    const snap = receiptSnapshot();
    const corr = (amountCents: number, accountId: string) =>
      ({ kind: "correction", amountCents, accountId, contact: snap.contact }) as const;
    expect(requiresAccountEligibility(snap, corr(5000, ACC))).toBe(false);
    expect(requiresAccountEligibility(snap, corr(5000, ACC.toUpperCase()))).toBe(false);
    expect(requiresAccountEligibility(snap, corr(8000, ACC))).toBe(true);
    expect(
      requiresAccountEligibility(snap, corr(5000, "77777777-7777-4777-8777-777777777777")),
    ).toBe(true);
    expect(requiresAccountEligibility(snap, { kind: "void" })).toBe(false);

    // Contact-only, original account now disabled: allowed, resolver never consulted.
    const disabled = vi.fn(async () => null);
    const c1 = deps({ resolveAccount: disabled });
    await createReceiptControlRequest(
      fd,
      {
        ...amountOnly(50),
        proposal: { kind: "correction", amount: 50, contact: { ...contact, phone: "0111111111" } },
      },
      c1.d,
    );
    expect(disabled).not.toHaveBeenCalled();

    // Amount change on the SAME (now disabled) account: refused.
    const c2 = deps({ resolveAccount: vi.fn(async () => null) });
    await expect(createReceiptControlRequest(fd, amountOnly(80, ACC), c2.d)).rejects.toMatchObject({
      code: "account_not_allowed",
    });
    expect(c2.d.resolveAccount).toHaveBeenCalledWith(fd, ACC, ACC);
  });

  it("verification re-checks the same account for a money change and holds Needs review when disabled", async () => {
    let allowed = true;
    const { d } = deps({ resolveAccount: vi.fn(async () => (allowed ? "Test Bank" : null)) });
    const created = await createReceiptControlRequest(owner, amountOnly(80, ACC), d);
    const approved = await decideReceiptControlRequest(
      owner,
      { requestId: created.id, decision: "approve", expectedVersion: created.version },
      d,
    );
    allowed = false;
    const out = await verifyReceiptControlRequest(
      owner,
      { requestId: approved.id, expectedVersion: approved.version },
      d,
    ).catch((e) => e);
    expect(out?.state).toBe("needs_review");
    expect((d.resolveAccount as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("cache identity is tenant+user+role; foreign snapshots are purged; effects cover every consumer", () => {
    expect(receiptIdentityKey({ authenticated: false })).toBeNull();
    const k = receiptIdentityKey({
      authenticated: true,
      tenant: { tenantId: "t1" },
      user: { n3UserKey: "u1" },
      role: "owner",
    });
    expect(k).toBe("t1:u1:owner");
    expect(
      receiptIdentityKey({
        authenticated: true,
        tenant: { tenantId: "t1" },
        user: { n3UserKey: "u1" },
        role: "front_desk",
      }),
    ).not.toBe(k);
    const keys: unknown[][] = [
      ["receipt-controls", "t0:u0:owner", "queue"],
      ["receipt-controls", "t1:u1:owner", "queue"],
    ];
    const removed: unknown[][] = [];
    purgeForeignReceiptCache(
      {
        removeQueries: ({ predicate }) => {
          for (const q of keys) if (predicate({ queryKey: q })) removed.push(q);
        },
      },
      k,
    );
    expect(removed).toEqual([["receipt-controls", "t0:u0:owner", "queue"]]);
    const inv: unknown[] = [];
    invalidateReceiptEffects({ invalidateQueries: ({ queryKey }) => inv.push(queryKey[0]) });
    for (const need of [
      "reservations",
      "departures",
      "checkout-preview",
      "financial-reporting",
      "deposits",
      "folio",
    ])
      expect(inv).toContain(need);
    expect(RECEIPT_EFFECT_QUERY_PREFIXES.length).toBe(inv.length);
  });

  it("race: claimed prior-approved Needs review cannot be rejected; completion stays fenced", async () => {
    const { d, mem } = deps();
    const created = await createReceiptControlRequest(owner, amountOnly(80), d);
    const approved = await decideReceiptControlRequest(
      owner,
      { requestId: created.id, decision: "approve", expectedVersion: created.version },
      d,
    );
    // Put the approved request into Needs review (prior-approved), then claim it.
    mem.rows.set(approved.id, { ...mem.rows.get(approved.id)!, state: "needs_review" });
    const before = mem.rows.get(approved.id)!;
    const exec = await mem.db.claim({
      tenantId: before.tenantId,
      requestId: before.id,
      expectedVersion: before.version,
      step: "verify",
      actor: "owner-1",
    } as any);
    expect(exec).toBeTruthy();
    const claimed = mem.rows.get(approved.id)!;
    expect(claimed.state).toBe("needs_review"); // claim leaves state as-is
    // A refreshed second Owner sees the bumped version and tries Reject.
    await expect(
      decideReceiptControlRequest(
        owner,
        { requestId: claimed.id, decision: "reject", expectedVersion: claimed.version },
        d,
      ),
    ).rejects.toMatchObject({ code: "claim_conflict" });
    expect(mem.rows.get(approved.id)!.state).toBe("needs_review"); // not terminal, active index held
  });

  it("staged SQL: any in-flight claim fences decisions (reject cannot terminate a claimed Needs review)", () => {
    const sql = readFileSync(
      "db/migrations-pending/20261002110000_hh_receipt_controls.sql",
      "utf8",
    );
    const decide = sql.slice(
      sql.indexOf("FUNCTION public.hotelhub_receipt_control_decide"),
      sql.indexOf("FUNCTION public.hotelhub_receipt_control_claim"),
    );
    expect(decide).toMatch(/state = 'claimed'\) THEN\s+RAISE EXCEPTION 'claim_conflict'/);
    expect(decide.indexOf("claim_conflict")).toBeLessThan(
      decide.indexOf("UPDATE public.hotel_receipt_control_requests"),
    );
    expect(mapDbError({ message: "claim_conflict" }).code).toBe("claim_conflict");
  });
});

describe("interrupted verification recovery (review finding 1)", () => {
  async function crashedMidVerify() {
    const ctx = await approved(() => receiptSnapshot({ amountCents: 8000 } as any));
    // Simulate the legacy split path / a crashed worker: claim succeeded,
    // process died before complete. Request is Applying with a claim held.
    const exec = await ctx.mem.db.claim({
      tenantId: "t1",
      requestId: ctx.req.id,
      expectedVersion: ctx.req.version,
      step: "verify",
      actor: "owner-1",
    });
    expect(exec).toBeTruthy();
    const stuck = ctx.mem.rows.get(ctx.req.id)!;
    expect(stuck.state).toBe("applying");
    return { ...ctx, exec: exec!, stuck };
  }

  it("stuck Applying shows only Recover (no Verify/Reject) to the Owner", async () => {
    const { d, stuck } = await crashedMidVerify();
    const [dto] = await toDTOsFor(stuck, d);
    expect(dto!.canVerify).toBe(false);
    expect(dto!.canReject).toBe(false);
    expect(dto!.canRecover).toBe(true);
    const [fdView] = await toDTOsFor(stuck, d, fd);
    expect(fdView!.canRecover).toBe(false);
  });

  it("recovery is refused while the claim is fresh, then releases a stale claim without any N3 call", async () => {
    const { d, mem, stuck } = await crashedMidVerify();
    const reads = (d.readEvidence as any).mock.calls.length;
    await expect(
      recoverReceiptControlRequest(
        owner,
        { requestId: stuck.id, expectedVersion: stuck.version },
        d,
      ),
    ).rejects.toMatchObject({ code: "claim_conflict" });
    mem.clock.now += (RECEIPT_VERIFY_STALE_SECONDS + 1) * 1000;
    const rec = await recoverReceiptControlRequest(
      owner,
      { requestId: stuck.id, expectedVersion: stuck.version },
      d,
    );
    expect(rec.state).toBe("approved_awaiting_n3");
    expect(rec.version).toBe(stuck.version + 1);
    expect(rec.canVerify).toBe(true);
    expect((d.readEvidence as any).mock.calls.length).toBe(reads); // no N3 read or write
    expect(mem.versions).toHaveLength(0); // totals unchanged by recovery
    await expect(
      recoverReceiptControlRequest(fd, { requestId: stuck.id, expectedVersion: stuck.version }, d),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("old worker can never complete the reclaimed claim; Owner then verifies to a proven result", async () => {
    const { d, mem, stuck, exec } = await crashedMidVerify();
    mem.clock.now += (RECEIPT_VERIFY_STALE_SECONDS + 1) * 1000;
    const rec = await recoverReceiptControlRequest(
      owner,
      { requestId: stuck.id, expectedVersion: stuck.version },
      d,
    );
    await expect(
      mem.db.complete({
        tenantId: "t1",
        requestId: stuck.id,
        executionId: exec,
        toState: "applied",
        outcomeCode: "verified",
        actor: "owner-1",
        version: { state: "active" } as any,
      }),
    ).rejects.toMatchObject({ code: "claim_not_found" });
    expect(mem.versions).toHaveLength(0);
    const out = await verifyReceiptControlRequest(
      owner,
      { requestId: rec.id, expectedVersion: rec.version },
      d,
    );
    expect(["applied", "needs_review"]).toContain(out.state);
    expect(mem.claims.size).toBe(0);
  });

  it("completion RPC failure in atomic Verify leaves nothing claimed (state unchanged)", async () => {
    const { d, mem, req } = await approved(() => receiptSnapshot());
    const orig = mem.db.complete;
    // Atomic SQL rolls back claim and complete together; mirror that here.
    d.db = {
      ...mem.db,
      async verifyAtomic() {
        throw new ReceiptControlError("receipt_control_store_failed");
      },
    };
    await expect(
      verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d),
    ).rejects.toMatchObject({ code: "receipt_control_store_failed" });
    expect(mem.rows.get(req.id)!.state).toBe("approved_awaiting_n3");
    expect(mem.claims.size).toBe(0);
    void orig;
  });

  it("rejected (terminal) stays terminal: recovery refused", async () => {
    const { d } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    const rej = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "reject" },
      d,
    );
    await expect(
      recoverReceiptControlRequest(owner, { requestId: rej.id, expectedVersion: rej.version }, d),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect((await d.db.get("t1", rej.id))!.state).toBe("rejected");
  });

  it("staged SQL: Verify is one transaction and recovery is fenced, stale-only and non-terminal", () => {
    const sql = readFileSync(
      "db/migrations-pending/20261002110000_hh_receipt_controls.sql",
      "utf8",
    );
    const atomic = sql.slice(sql.indexOf("FUNCTION public.hotelhub_receipt_control_verify_atomic"));
    expect(atomic).toMatch(/hotelhub_receipt_control_claim\(/);
    expect(atomic).toMatch(/hotelhub_receipt_control_complete\(/);
    const rec = sql.slice(sql.indexOf("FUNCTION public.hotelhub_receipt_control_recover"));
    expect(rec).toMatch(/FOR UPDATE/);
    expect(rec).toMatch(/state NOT IN \('applying','needs_review'\)/);
    expect(rec).toMatch(/make_interval\(secs => p_stale_seconds\)/);
    expect(rec).toMatch(/SET state = 'released'/);
    expect(rec).toMatch(/version = version \+ 1/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_recover\([^)]*\) TO service_role/,
    );
  });
});

describe("server paging (review finding 2)", () => {
  async function many(n: number) {
    const ctx = deps();
    for (let i = 0; i < n; i++) {
      await ctx.mem.db.create({
        tenantId: "t1",
        reservationId: RES,
        depositId: `dep-${i}`,
        clientRequestId: `key-${i}`,
        fingerprint: `fp-${i}`,
        kind: "correction",
        reason: "r",
        original: receiptSnapshot() as any,
        proposal: correction().proposal as any,
        comparison: { depositDeltaCents: 0, balanceDeltaCents: 0, fields: [] } as any,
        actor: "fd-1",
      } as any);
    }
    return ctx;
  }
  it("more than 200 open requests: every one is reachable through pages with an exact total", async () => {
    const { d } = await many(237);
    const seen = new Set<string>();
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const p = await listReceiptControlRequests(owner, { queue: true, offset, limit: 100 }, d);
      expect(p.total).toBe(237);
      p.requests.forEach((r) => seen.add(r.id));
      offset = p.nextOffset;
      pages++;
    }
    expect(seen.size).toBe(237);
    expect(pages).toBe(3);
  });
  it("defaults to 50 per page and rejects out-of-bound page sizes", async () => {
    const { d } = await many(60);
    const p = await listReceiptControlRequests(owner, { queue: true }, d);
    expect(p.requests).toHaveLength(50);
    expect(p.nextOffset).toBe(50);
    await expect(
      listReceiptControlRequests(owner, { queue: true, limit: 101 }, d),
    ).rejects.toMatchObject({ code: "invalid_page" });
    await expect(
      listReceiptControlRequests(owner, { queue: true, offset: -1 }, d),
    ).rejects.toMatchObject({ code: "invalid_page" });
  });
  it("client reservation reader walks every page and fails closed past its budget", async () => {
    const pages = [
      { requests: [{ id: "a" }], total: 2, offset: 0, limit: 100, nextOffset: 1 },
      { requests: [{ id: "b" }], total: 2, offset: 1, limit: 100, nextOffset: null },
    ] as any[];
    let i = 0;
    const all = await listAllReceiptControls({ reservationId: RES }, async () => ({
      ...pages[i++],
      transport: { configured: false },
    }));
    expect(all.requests.map((r) => r.id)).toEqual(["a", "b"]);
    await expect(
      listAllReceiptControls(
        { reservationId: RES },
        async () => ({ ...pages[0], transport: { configured: false } }),
        3,
      ),
    ).rejects.toMatchObject({ code: "receipt_control_list_incomplete" });
  });
  it("supabase list uses range + exact count + stable order (no silent limit)", () => {
    const src = readFileSync("src/lib/receipt-controls-store.server.ts", "utf8");
    expect(src).not.toMatch(/\.limit\(200\)/);
    expect(src).toMatch(/count: "exact"/);
    expect(src).toMatch(/\.range\(f\.offset, f\.offset \+ f\.limit - 1\)/);
  });
});

async function toDTOsFor(row: RequestRow, d: StoreDeps, who: any = owner) {
  const { toDTOs } = await import("../receipt-controls-store.server");
  return toDTOs(who, [row], d);
}

describe("request requires proven exact journal (review 2e755)", () => {
  it("read-only diagnostics reach only Owner and cannot authorize a request", async () => {
    const reasons = ["journal_row_doc_code_missing", "journal_row_doc_code_null"];
    const { d, mem } = deps({
      evidence: () => receiptSnapshot({ journalExact: false, journalDiagnostics: reasons }),
    });
    expect(
      await readReceiptOriginalForDialog(owner, { reservationId: RES, depositId: DEP }, d),
    ).toMatchObject({ journal: { exact: false, reasons } });
    expect(
      await readReceiptOriginalForDialog(fd, { reservationId: RES, depositId: DEP }, d),
    ).toMatchObject({ journal: { exact: false, reasons: [] } });
    expect(mem.rows.size).toBe(0);
    for (const actor of [owner, fd])
      await expect(createReceiptControlRequest(actor, correction(), d)).rejects.toMatchObject({
        code: "journal_unproven",
      });
    expect(mem.rows.size).toBe(0);
    expect(mem.decisions).toHaveLength(0);
    expect(mem.versions).toHaveLength(0);
    expect(mem.claims.size).toBe(0);
  });
  it("active + unmatched but journal unproven: request refused, nothing stored", async () => {
    const { d, mem } = deps({ evidence: () => receiptSnapshot({ journalExact: false } as any) });
    await expect(createReceiptControlRequest(fd, correction(), d)).rejects.toMatchObject({
      code: "journal_unproven",
    });
    expect(mem.rows.size).toBe(0);
    expect(statusForReceiptControlError("journal_unproven")).toBe(409);
  });
  it("unavailable N3 evidence is an explicit refusal at request time", async () => {
    const { d, mem } = deps({
      evidence: () => {
        throw new ReceiptControlError("n3_evidence_unavailable");
      },
    });
    await expect(createReceiptControlRequest(fd, correction(), d)).rejects.toMatchObject({
      code: "n3_evidence_unavailable",
    });
    expect(mem.rows.size).toBe(0);
  });
  it("approval holds when the journal is no longer exactly proven", async () => {
    let exact = true;
    const { d } = deps({ evidence: () => receiptSnapshot({ journalExact: exact } as any) });
    const req = await createReceiptControlRequest(fd, correction(), d);
    exact = false;
    const out = await decideReceiptControlRequest(
      owner,
      { requestId: req.id, expectedVersion: 1, decision: "approve" },
      d,
    );
    expect(out.state).not.toBe("approved_awaiting_n3");
  });
});
