import { describe, expect, it, vi } from "vitest";
import {
  applyReceiptCorrection,
  checkReceiptCorrectionResult,
  type ReceiptAutomationDeps,
} from "../receipt-automation-execution.server";
import type { AutomationRequestRow, ReceiptAutomationDb } from "../receipt-automation-store.server";
import { RECEIPT_50, PROPOSAL_65 } from "./fixtures/receipt-automation";
import { ReceiptControlError } from "../receipt-controls";
const actor = {
  tenantId: "tenant",
  n3TenantKey: "sandbox",
  n3UserKey: "owner",
  n3Token: "server-only",
  role: "owner" as const,
};
function fixture(
  options: {
    timeout?: boolean;
    journal?: boolean;
    contact?: boolean;
    dbFailure?: boolean;
    direct?: boolean;
    disabled?: boolean;
    legacy?: boolean;
    revoked?: boolean;
  } = {},
) {
  let row: AutomationRequestRow = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenantId: "tenant",
    reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    depositId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    clientRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    fingerprint: "f",
    kind: "correction",
    reason: "guest no small notes",
    original: RECEIPT_50,
    proposal: PROPOSAL_65,
    comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
    executionMode: options.legacy ? "manual" : "direct",
    generation: options.legacy ? 1 : 2,
    state: "pending",
    version: 1,
    requestedBy: "staff",
    requestedAt: "2026-10-03",
    decidedBy: null,
    decidedAt: null,
    approvedBy: null,
    approvedAt: null,
    outcomeCode: null,
    automation: options.legacy
      ? null
      : {
          generation: 2,
          policy: {
            revision: "0",
            depositApprovalRequired: !options.direct,
            contactApprovalRequired: false,
          },
          authorizationKind: null,
          authorizedAt: null,
          authorizedBy: null,
          categories: { deposit: true, contact: false },
        },
    attempt: null,
  };
  let effective = 5000,
    versions = 0,
    sent = 0,
    freshChecks = 0,
    failed = false;
  const db: ReceiptAutomationDb = {
    get: async () => structuredClone(row),
    create: vi.fn(),
    authorize: async (_a, _id, version, kind) => {
      if (kind === "reject") throw new ReceiptControlError("invalid_transition");
      if (row.version !== version) throw new ReceiptControlError("version_conflict");
      row = {
        ...row,
        state: "approved_awaiting_n3",
        version: row.version + 1,
        automation: {
          ...row.automation!,
          authorizationKind: kind,
          authorizedAt: "now",
          authorizedBy: "owner",
        },
        approvedAt: kind === "manual_approval" ? "now" : null,
      };
      return structuredClone(row);
    },
    reserveDispatch: async (_a, _id, version, hash) => {
      if (row.attempt) return { attempt: row.attempt, dispatchGranted: false };
      if (row.version !== version) throw new ReceiptControlError("version_conflict");
      row = {
        ...row,
        state: "applying",
        version: row.version + 1,
        attempt: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          claimedVersion: row.version + 1,
          payloadHash: hash,
          phase: "reserved",
        },
      };
      return { attempt: row.attempt!, dispatchGranted: true };
    },
    hold: async (_a, _id, _v, code) => {
      row = { ...row, state: "needs_review", version: row.version + 1, outcomeCode: code };
      return row;
    },
    settle: async (_a, _id, _attempt, _claim, version, result) => {
      if (row.state === "applied") return row;
      if (row.version !== version) throw new ReceiptControlError("claim_stale");
      if (options.dbFailure && !failed && result.kind === "verified") {
        failed = true;
        throw new Error("DB unavailable");
      }
      if (result.kind === "verified") {
        effective = result.version.amountCents;
        versions++;
        row = {
          ...row,
          state: "applied",
          version: row.version + 1,
          attempt: { ...row.attempt!, phase: "confirmed" },
        };
      } else
        row = {
          ...row,
          state: "needs_review",
          version: row.version + 1,
          attempt: { ...row.attempt!, phase: result.kind === "unknown" ? "unknown" : "rejected" },
        };
      return structuredClone(row);
    },
  };
  const deps: ReceiptAutomationDeps = {
    db,
    policy: async () => ({
      revision: "0",
      depositApprovalRequired: !options.direct,
      contactApprovalRequired: false,
    }),
    enabled: () => !options.disabled,
    budgetMs: 1000,
    now: Date.now,
    freshOwner: async () => {
      freshChecks++;
      if (options.revoked && freshChecks > 1) throw new ReceiptControlError("forbidden");
    },
    prepare: async () => ({
      body: { totalAmount: 65 },
      payloadHash: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
    send: async () => {
      sent++;
      return options.timeout
        ? { kind: "transport_error", reason: "timeout", durationMs: 1 }
        : { kind: "response", status: 200, body: { code: "0000", data: {} }, durationMs: 1 };
    },
    readResult: async () => ({
      ...RECEIPT_50,
      amountCents: 6500,
      paymentLines: RECEIPT_50.paymentLines.map((l) => ({ ...l, amountCents: 6500 })),
      journalExact: options.journal !== false,
      contact:
        options.contact === false
          ? { ...RECEIPT_50.contact, remark3: "wrong" }
          : RECEIPT_50.contact,
    }),
    noWriteRejected: () => false,
    dto: async (_actor, r) => ({
      ...r,
      bookingReference: "TEST",
      requestedByLabel: null,
      decidedByLabel: null,
      selfApproved: false,
      canApprove: false,
      canReject: false,
      canVerify: false,
      canRecover: false,
      outcomeMessage: null,
      alert: null,
      automation: r.automation,
      canApply: false,
      canCheckResult: !!r.attempt,
    }),
  };
  return { deps, get: () => ({ row, effective, versions, sent }) };
}
describe("one-dispatch correction pipeline", () => {
  it.each([false, true])(
    "Owner approval/direct produces MYR65 once (direct=%s)",
    async (direct) => {
      const f = fixture({ direct });
      const result = await applyReceiptCorrection(
        actor,
        { requestId: f.get().row.id, expectedVersion: 1, action: direct ? "apply" : "approve" },
        f.deps,
      );
      expect(result.outcome).toBe("applied");
      expect(f.get()).toMatchObject({ effective: 6500, versions: 1, sent: 1 });
      await applyReceiptCorrection(
        actor,
        { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
        f.deps,
      );
      expect(f.get().sent).toBe(1);
      expect(f.get().row.approvedAt === null).toBe(direct);
    },
  );
  it("FrontDesk, legacy requests and dormant capability never dispatch", async () => {
    for (const option of [{ legacy: true }, { disabled: true }]) {
      const f = fixture(option);
      await expect(
        applyReceiptCorrection(
          actor,
          { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
          f.deps,
        ),
      ).rejects.toThrow();
      expect(f.get().sent).toBe(0);
    }
    const f = fixture();
    await expect(
      applyReceiptCorrection(
        { ...actor, role: "front_desk" },
        { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.get().sent).toBe(0);
  });
  it("timeout/retry never resends; explicit GET reconciliation completes once", async () => {
    const f = fixture({ timeout: true });
    expect(
      (
        await applyReceiptCorrection(
          actor,
          { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
          f.deps,
        )
      ).outcome,
    ).toBe("needs_review");
    await applyReceiptCorrection(
      actor,
      { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
      f.deps,
    );
    expect(f.get().sent).toBe(1);
    expect(f.get().effective).toBe(5000);
    await checkReceiptCorrectionResult(actor, f.get().row.id, f.deps);
    await checkReceiptCorrectionResult(actor, f.get().row.id, f.deps);
    expect(f.get()).toMatchObject({ sent: 1, versions: 1, effective: 6500 });
  });
  it.each([{ journal: false }, { contact: false }])(
    "unproven result keeps effective MYR50 %j",
    async (option) => {
      const f = fixture(option);
      expect(
        (
          await applyReceiptCorrection(
            actor,
            { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
            f.deps,
          )
        ).outcome,
      ).toBe("needs_review");
      expect(f.get()).toMatchObject({ effective: 5000, versions: 0, sent: 1 });
    },
  );
  it("success followed by DB failure settles later with GET only", async () => {
    const f = fixture({ dbFailure: true });
    await applyReceiptCorrection(
      actor,
      { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
      f.deps,
    );
    expect(f.get().effective).toBe(5000);
    await checkReceiptCorrectionResult(actor, f.get().row.id, f.deps);
    expect(f.get()).toMatchObject({ effective: 6500, versions: 1, sent: 1 });
  });
  it("fresh Owner revocation before dispatch prevents Update", async () => {
    const f = fixture({ revoked: true });
    await applyReceiptCorrection(
      actor,
      { requestId: f.get().row.id, expectedVersion: 1, action: "approve" },
      f.deps,
    );
    expect(f.get().sent).toBe(0);
  });
});
