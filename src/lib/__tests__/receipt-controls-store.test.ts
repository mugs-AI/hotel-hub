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
  type ReceiptControlDb,
  type RequestRow,
  type StoreDeps,
} from "../receipt-controls-store.server";
import {
  executeReceiptControlRequest,
  verifyReceiptControlRequest,
} from "../receipt-controls-execution.server";
import { loadReceiptOverlay } from "../effective-receipts.server";
import { deliverReceiptAlerts } from "../receipt-alert-delivery.server";
import { statusForReceiptControlError } from "../receipt-controls-http.server";
import { MANUAL_APPROVAL_MESSAGE, ReceiptControlError, type ReceiptSnapshot } from "../receipt-controls";
import { receiptSnapshot } from "./fixtures/receipt-controls";
import { ReceiptRequestCard } from "../../components/ReceiptApprovalQueue";
import { receiptAlertLabel } from "../../components/ReceiptAlertStatus";
import { provisionalDeltaLines, parseAmountInput } from "../../components/ReceiptControlRequestDialog";

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
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const active = ["pending", "approved_awaiting_n3", "applying", "failed", "needs_review"];
  const db: ReceiptControlDb = {
    async create(a) {
      const existing = [...rows.values()].find((r) => r.clientRequestId === a.clientRequestId);
      if (existing) {
        if (existing.fingerprint !== a.fingerprint) throw new ReceiptControlError("receipt_control_key_conflict");
        return existing;
      }
      if ([...rows.values()].some((r) => r.depositId === a.depositId && active.includes(r.state)))
        throw new ReceiptControlError("receipt_control_active_exists");
      const row: RequestRow = {
        id: id(), tenantId: a.tenantId, reservationId: a.reservationId, depositId: a.depositId,
        clientRequestId: a.clientRequestId, fingerprint: a.fingerprint, kind: a.kind, reason: a.reason,
        original: a.original, proposal: a.proposal, comparison: a.comparison, executionMode: "manual",
        state: "pending", version: 1, requestedBy: a.actor, requestedAt: new Date().toISOString(),
        decidedBy: null, decidedAt: null, outcomeCode: null,
      };
      rows.set(row.id, row);
      alerts.push({ requestId: row.id, event: "pending", requestVersion: 1, status: "pending", lastErrorCode: null, createdAt: "1" });
      return row;
    },
    async decide(a) {
      const r = rows.get(a.requestId)!;
      if (r.version !== a.expectedVersion) throw new ReceiptControlError("version_conflict");
      const ok =
        (a.decision === "approve" && r.state === "pending") ||
        (a.decision === "hold" && ["pending", "approved_awaiting_n3"].includes(r.state)) ||
        (a.decision === "reject" && ["pending", "needs_review"].includes(r.state));
      if (!ok) throw new ReceiptControlError("invalid_transition");
      decisions.push({ requestId: r.id, decision: a.decision, actor: a.actor, selfApproved: a.actor === r.requestedBy, createdAt: "1" });
      const next = { ...r, state: a.toState, version: r.version + 1, outcomeCode: a.outcomeCode,
        decidedBy: a.decision === "hold" ? r.decidedBy : a.actor };
      rows.set(r.id, next);
      return next;
    },
    async claim(a) {
      const r = rows.get(a.requestId)!;
      if (r.version !== a.expectedVersion || !["approved_awaiting_n3", "needs_review"].includes(r.state)) return null;
      if (claims.has(r.id)) return null;
      const c = id();
      claims.set(r.id, c);
      rows.set(r.id, { ...r, state: r.state === "approved_awaiting_n3" ? "applying" : r.state, version: r.version + 1 });
      return c;
    },
    async complete(a) {
      const r = rows.get(a.requestId)!;
      if (claims.get(r.id) !== a.executionId) throw new ReceiptControlError("claim_not_found");
      claims.delete(r.id);
      if ((a.toState === "applied") !== (a.version !== null)) throw new ReceiptControlError("invalid_transition");
      if (a.version) versions.push({ depositId: r.depositId, ...a.version });
      const next = { ...r, state: a.toState, version: r.version + 1, outcomeCode: a.outcomeCode };
      rows.set(r.id, next);
      return next;
    },
    async get(_t, rid) { return rows.get(rid) ?? null; },
    async list(_t, f) {
      return [...rows.values()].filter((r) =>
        (!f.requestedBy || r.requestedBy === f.requestedBy) && (!f.states || f.states.includes(r.state)));
    },
    async decisions() { return decisions; },
    async alerts() { return alerts; },
  };
  return { db, rows, decisions, versions, claims };
}

function deps(over: Partial<StoreDeps> & { evidence?: () => ReceiptSnapshot } = {}) {
  const mem = memoryDb();
  const audit = vi.fn(async () => {});
  const d: StoreDeps = {
    db: mem.db,
    readEvidence: vi.fn(async () => (over.evidence ? over.evidence() : receiptSnapshot())),
    resolveAccount: vi.fn(async () => "BANK-2 — Other Bank"),
    walkInCustomerId: vi.fn(async () => CUST),
    labels: async () => new Map([["fd-1", "Front Desk A"], ["owner-1", "Owner"]]),
    bookingRefs: async () => new Map([[RES, "BK-TEST-1"]]),
    audit,
    ...over,
  };
  return { d, mem, audit };
}

const contact = { name: "Test Guest", address: "1 Test Street", phone: "0100000000", email: "guest@example.test" };
const correction = (amount = 80, accountId = ACC) => ({
  reservationId: RES, depositId: DEP, clientRequestId: KEY, reason: "Keyed RM50 instead of RM80",
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
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "hotel.receipt_control.requested" }));
    const detail = (audit.mock.calls[0] as any)[0].detail;
    expect(JSON.stringify(detail)).not.toContain("RM50"); // ids/outcomes only
  });
  it("housekeeper is refused", async () => {
    const { d } = deps();
    await expect(createReceiptControlRequest(hk, correction(), d)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("mandatory reason", async () => {
    const { d } = deps();
    await expect(createReceiptControlRequest(fd, { ...correction(), reason: "  " }, d)).rejects.toMatchObject({ code: "invalid_reason" });
  });
  it("replays the same client key and refuses the key with different content", async () => {
    const { d } = deps();
    const a = await createReceiptControlRequest(fd, correction(), d);
    const b = await createReceiptControlRequest(fd, correction(), d);
    expect(b.id).toBe(a.id);
    await expect(createReceiptControlRequest(fd, correction(90), d)).rejects.toMatchObject({ code: "receipt_control_key_conflict" });
  });
  it("matched/refunded receipt cannot be requested", async () => {
    const { d } = deps({ evidence: () => receiptSnapshot({ matchingState: "matched" }) });
    await expect(createReceiptControlRequest(fd, correction(), d)).rejects.toMatchObject({ code: "receipt_restricted" });
  });
  it("hidden/unverified new deposit account is refused; verified one shows its label", async () => {
    const other = "77777777-7777-4777-8777-777777777777";
    const bad = deps({ resolveAccount: async () => null });
    await expect(createReceiptControlRequest(fd, correction(80, other), bad.d)).rejects.toMatchObject({ code: "account_not_allowed" });
    const ok = deps();
    const dto = await createReceiptControlRequest(fd, correction(80, other), ok.d);
    expect(dto.comparison.fields.find((f) => f.label === "Deposit to")?.requested).toBe("BANK-2 — Other Bank");
  });
  it("contact line over 100 UTF-16 units is refused, not truncated", async () => {
    const { d } = deps();
    await expect(
      createReceiptControlRequest(fd, { ...correction(), proposal: { kind: "correction", amount: 80, accountId: ACC, contact: { ...contact, email: "a".repeat(101) } } }, d),
    ).rejects.toBeInstanceOf(ReceiptControlError);
  });
});

describe("decide", () => {
  it("Owner approval moves to approved-awaiting-N3 with the manual message and does not change totals", async () => {
    const { d, mem } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    const dto = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d);
    expect(dto.state).toBe("approved_awaiting_n3");
    expect(dto.outcomeMessage).toBe(MANUAL_APPROVAL_MESSAGE);
    expect(dto.selfApproved).toBe(false);
    expect(mem.versions).toHaveLength(0);
  });
  it("Front Desk cannot approve", async () => {
    const { d } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    await expect(decideReceiptControlRequest(fd, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("Owner self-approval is allowed and flagged", async () => {
    const { d, audit } = deps();
    const req = await createReceiptControlRequest(owner, correction(), d);
    const dto = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d);
    expect(dto.selfApproved).toBe(true);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.objectContaining({ selfApproved: true }) }));
  });
  it("N3 changed since request → held Needs review instead of approved", async () => {
    let fp = "fp-original";
    const { d } = deps({ evidence: () => receiptSnapshot({ sourceFingerprint: fp }) });
    const req = await createReceiptControlRequest(fd, correction(), d);
    fp = "fp-external-edit";
    const dto = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d);
    expect(dto.state).toBe("needs_review");
    expect(dto.canVerify).toBe(false);
  });
  it("walk-in mapping change holds approval", async () => {
    const { d } = deps({ walkInCustomerId: async () => "99999999-9999-4999-8999-999999999999" });
    const req = await createReceiptControlRequest(fd, correction(), d);
    const dto = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d);
    expect(dto.state).toBe("needs_review");
  });
  it("stale version is refused", async () => {
    const { d } = deps();
    const req = await createReceiptControlRequest(fd, correction(), d);
    await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "reject" }, d);
    await expect(decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, d)).rejects.toMatchObject({ code: "version_conflict" });
  });
});

describe("list scope", () => {
  it("Front Desk sees only own requests; Owner sees all", async () => {
    const { d } = deps();
    await createReceiptControlRequest(owner, correction(), d);
    expect(await listReceiptControlRequests(fd, {}, d)).toHaveLength(0);
    expect(await listReceiptControlRequests(owner, {}, d)).toHaveLength(1);
  });
});

async function approved(evidence: () => ReceiptSnapshot, proposal = correction()) {
  let phase: "request" | "after" = "request";
  const ctx = deps({ evidence: () => (phase === "request" ? receiptSnapshot() : evidence()) });
  const req = await createReceiptControlRequest(fd, proposal, ctx.d);
  const ok = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, ctx.d);
  phase = "after";
  return { ...ctx, req: ok };
}

describe("execute + verify (manual mode)", () => {
  it("execute never writes and returns the manual instruction", async () => {
    const { d, req } = await approved(() => receiptSnapshot());
    const out = await executeReceiptControlRequest(owner, req.id, d);
    expect(out.message).toBe(MANUAL_APPROVAL_MESSAGE);
    await expect(executeReceiptControlRequest(owner, req.id, d, { directEdit: true, voidReplace: false, manual: true })).rejects.toMatchObject({ code: "automation_unavailable" });
  });
  it("exact N3 readback applies and records one version", async () => {
    const after = receiptSnapshot({
      amountCents: 8000,
      paymentLines: [{ accountId: ACC, code: "BANK-T", savedName: "Test Bank", amountCents: 8000 }],
      sourceFingerprint: "fp-after",
    });
    const { d, req, mem } = await approved(() => after);
    const dto = await verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d);
    expect(dto.state).toBe("applied");
    expect(mem.versions).toEqual([expect.objectContaining({ state: "active", amountCents: 8000 })]);
  });
  it("unchanged N3 receipt (change not made) holds Needs review, no version", async () => {
    const { d, req, mem } = await approved(() => receiptSnapshot());
    const dto = await verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d);
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
    const req = await createReceiptControlRequest(fd, { ...correction(), proposal: { kind: "void" } }, ctx.d);
    const ok = await decideReceiptControlRequest(owner, { requestId: req.id, expectedVersion: 1, decision: "approve" }, ctx.d);
    gone = true;
    const dto = await verifyReceiptControlRequest(owner, { requestId: ok.id, expectedVersion: ok.version }, ctx.d);
    expect(dto.state).toBe("needs_review");
    expect(ctx.mem.versions).toHaveLength(0);
  });
  it("unknown cancellation state holds Needs review", async () => {
    const { d, req } = await approved(() => receiptSnapshot({ documentState: "unknown" }), { ...correction(), proposal: { kind: "void" } } as any);
    const dto = await verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d);
    expect(dto.state).toBe("needs_review");
  });
  it("confirmed void records a voided version", async () => {
    const { d, req, mem } = await approved(() => receiptSnapshot({ documentState: "voided" }), { ...correction(), proposal: { kind: "void" } } as any);
    const dto = await verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d);
    expect(dto.state).toBe("applied");
    expect(mem.versions[0]).toMatchObject({ state: "voided" });
  });
  it("expired N3 session changes nothing", async () => {
    const { d, req, mem } = await approved(() => {
      throw new ReceiptControlError("unauthorized");
    });
    await expect(verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d)).rejects.toMatchObject({ code: "unauthorized" });
    expect((await mem.db.get("t1", req.id))!.state).toBe("approved_awaiting_n3");
  });
  it("duplicate verify claim is refused", async () => {
    const { d, req, mem } = await approved(() => receiptSnapshot());
    await mem.db.claim({ tenantId: "t1", requestId: req.id, expectedVersion: req.version, step: "verify", actor: "owner-1" });
    await expect(verifyReceiptControlRequest(owner, { requestId: req.id, expectedVersion: req.version }, d)).rejects.toMatchObject({ code: "claim_conflict" });
  });
  it("Front Desk cannot verify", async () => {
    const { d, req } = await approved(() => receiptSnapshot());
    await expect(verifyReceiptControlRequest(fd, { requestId: req.id, expectedVersion: req.version }, d)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("effective overlay loader", () => {
  it("is empty when the staged tables are not installed", async () => {
    const o = await loadReceiptOverlay("t1", ["d1"], { versions: async () => null, unresolved: async () => null });
    expect(o.size).toBe(0);
  });
  it("fails closed on real read errors", async () => {
    await expect(
      loadReceiptOverlay("t1", ["d1"], { versions: async () => { throw new Error("boom"); }, unresolved: async () => [] }),
    ).rejects.toThrow();
  });
  it("confirmed void stays excluded while replacement failed (Needs review)", async () => {
    const o = await loadReceiptOverlay("t1", ["d1"], {
      versions: async () => [{ depositId: "d1", requestId: "r", versionNo: 1, state: "voided", receiptId: "x", docCode: "OR", documentDate: "d", currency: "MYR", amountCents: 5000, paymentLines: [], replacementOf: null, verifiedAt: "t" }],
      unresolved: async () => ["d1"],
    });
    expect(o.get("d1")).toMatchObject({ state: "needs_review", amountCents: null });
  });
});

describe("db error mapping + http status", () => {
  it("maps missing staged objects to unavailable", () => {
    expect(mapDbError({ code: "42883", message: "function does not exist" }).code).toBe("receipt_controls_unavailable");
    expect(mapDbError({ message: "ERROR: version_conflict" }).code).toBe("version_conflict");
    expect(statusForReceiptControlError("receipt_controls_unavailable")).toBe(503);
    expect(statusForReceiptControlError("forbidden")).toBe(403);
  });
});

describe("alerts (transport disabled)", () => {
  it("claims and settles as disabled; never sends", async () => {
    const settle = vi.fn(async () => {});
    const out = await deliverReceiptAlerts("t1", {
      claim: async () => [{ id: "a1", tenantId: "t1", requestId: "r1", event: "pending" }],
      settle,
    });
    expect(out).toEqual({ claimed: 1, sent: 0, disabled: 1 });
    expect(settle).toHaveBeenCalledWith("t1", "a1", "disabled", "transport_not_configured");
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
    const [dto] = await listReceiptControlRequests(owner, {}, d);
    const html = renderToStaticMarkup(createElement(ReceiptRequestCard, { r: { ...dto!, selfApproved: true } }));
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Review");
    expect(html).toContain("audited");
    expect(html).toContain("Notification:");
  });
});
