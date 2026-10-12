import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actor, source, guest, saved } from "./fixtures/source-billing";
import { createSourceBillStore } from "../source-billing-store.server";
import {
  runSourceBillStep,
  reconcileSourceBills,
  readSourceBillingStatus,
} from "../source-billing-coordinator.server";
import * as sourceGates from "../source-billing-n3.server";
import * as gates from "../settlement-contracts.server";
import { n3BillingClient, buildCashSalePayload } from "../n3-billing.server";
import type { SettlementRpc } from "../settlement-store.server";
import type { LegStoredIntent } from "../source-billing-store.server";
function fixture() {
  const stay = structuredClone(saved()),
    writes: string[] = [],
    rpcCalls: string[] = [];
  const receiptId = "cccccccc-1111-4111-8111-cccccccccccc";
  let receiptPayload: Record<string, unknown> | null = null;
  const exists = new Set<string>(),
    codes = new Map([
      [source, "CS-ASSIGNED-A"],
      [guest, "CS-ASSIGNED-B"],
    ]);
  const ids = new Map([
    [source, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"],
    [guest, "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"],
  ]);
  const fault = { timeoutLeg: "", status: 200, siblingBill: false };
  const rpc: SettlementRpc = async (name, args) => {
    rpcCalls.push(name);
    const leg = stay.legs.find((l) => l.id === args.p_leg_id)!;
    if (name === "hh_source_billing_read")
      return {
        data: structuredClone({
          ...stay,
          revision: String(stay.legs.reduce((n, l) => n + BigInt(l.revision) - 1n, 1n)),
        }),
        error: null,
      };
    if (name.endsWith("_claim")) {
      if (leg.dispatches.some((d) => d.claim.kind === args.p_step))
        return { data: null, error: null };
      if (leg.revision !== args.p_revision)
        return { data: null, error: { message: "settlement_stale_revision" } };
      leg.revision = String(BigInt(leg.revision) + 1n);
      leg.state = "bill_dispatched";
      const claim = {
        attemptId:
          "99999999-9999-4999-8999-" +
          String((stay.legs.indexOf(leg) + 1) * 100 + leg.dispatches.length).padStart(12, "0"),
        intentId: leg.id,
        kind: args.p_step,
        expectedRevision: leg.revision,
        payloadDigest: args.p_payload_digest,
      };
      leg.dispatches.push({
        claim: claim as never,
        facts: structuredClone(args.p_dispatch_facts) as never,
        outcome: null,
      });
      return { data: structuredClone(claim), error: null };
    }
    if (name.endsWith("_outcome")) {
      leg.dispatches.find((d) => d.claim.attemptId === args.p_attempt_id)!.outcome =
        structuredClone(args.p_outcome) as never;
      leg.revision = String(BigInt(leg.revision) + 1n);
      leg.state = "needs_review";
    }
    if (name.endsWith("_prove")) {
      leg.evidence!.push(structuredClone(args.p_proof) as never);
      leg.revision = String(BigInt(leg.revision) + 1n);
      leg.state = "bill_verified";
    }
    return { data: structuredClone(leg), error: null };
  };
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const payload = JSON.parse(String(init.body)),
        leg = payload.customerId === 8 ? source : guest;
      writes.push(leg);
      if (String(url).includes("ARReceipts/Create")) {
        receiptPayload = payload;
        return Response.json({ code: "0000", data: { id: receiptId } });
      }
      exists.add(leg);
      if (fault.timeoutLeg === leg) throw Error("synthetic timeout after create");
      return Response.json({ code: "0000", data: { id: ids.get(leg) } }, { status: fault.status });
    }
    if (String(url).includes("AccountCodes"))
      return Response.json({
        code: "0000",
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          code: "SYNTHETIC-BANK",
          name: "Synthetic bank",
          accountType: { typeCode: "BCA" },
          specialCode: "BAC",
          isActive: true,
          hasChildren: false,
          currencyId: 1,
        },
      });
    if (String(url).includes(receiptId) && receiptPayload) {
      const p = receiptPayload,
        amount = 40,
        code = "OR-ASSIGNED-GUEST",
        ref = String(p.referenceNo);
      const gl = (id: string, account: string, debit: number, credit: number) => ({
        isCancelled: false,
        accountId: id,
        account: { id, code: account },
        debit,
        credit,
        docCode: code,
        referenceNo: ref,
        docDate: p.docDate,
        currencyId: 1,
        currencyRate: 1,
        customerId: 7,
      });
      const data = String(url).includes("GLPosting")
        ? [
            gl("11111111-1111-4111-8111-111111111111", "SYNTHETIC-BANK", amount, 0),
            gl("77777777-7777-4777-8777-777777777777", "SYNTHETIC-AR", 0, amount),
          ]
        : {
            ...p,
            isCancelled: false,
            id: receiptId,
            docType: "AROR",
            docCode: code,
            customerCode: "SYNTHETIC-AR",
            currencyCode: "MYR",
            totalAmount: amount,
            netTotalAmount: amount,
            outstandingAmount: amount,
            refundAmount: 0,
            knockoff: [],
            isMultiPayment: false,
            accountId: "11111111-1111-4111-8111-111111111111",
            accountCode: "SYNTHETIC-BANK",
          };
      return Response.json({ code: "0000", data });
    }
    let leg = [...ids].find(([, id]) => String(url).includes(id))?.[0];
    if (!leg || !exists.has(leg)) return Response.json({ code: "4040" }, { status: 404 });
    if (fault.siblingBill && leg === guest) leg = source;
    const intent = stay.legs.find((l) => l.id === leg)!,
      s = intent.snapshot,
      payload = buildCashSalePayload(s, { intentId: intent.id });
    const code = codes.get(leg)!,
      reference = String(payload.referenceNo),
      amount = s.totalCents / 100;
    const row = (id: string, account: string, debit: number, credit: number) => ({
      isCancelled: false,
      accountId: id,
      account: { id, code: account },
      debit,
      credit,
      docCode: code,
      referenceNo: reference,
      docDate: s.billDate,
      currencyId: 1,
      currencyRate: 1,
      customerId: s.customerId,
    });
    const data = String(url).includes("GLPosting")
      ? [
          row("77777777-7777-4777-8777-777777777777", "SYNTHETIC-AR", amount, 0),
          row("88888888-8888-4888-8888-888888888888", "SYNTHETIC-SALES", 0, amount),
        ]
      : {
          ...payload,
          isCancelled: false,
          id: ids.get(leg),
          docType: "CS",
          docCode: code,
          currencyCode: "MYR",
          totalAmount: amount,
          netTotalAmount: amount,
          subtotalAmount: amount,
          taxTotalAmount: 0,
          outstandingAmount: amount,
        };
    return Response.json({ code: "0000", data }, { status: fault.status });
  });
  vi.stubGlobal("fetch", fetch);
  const store = createSourceBillStore(rpc);
  const invalidateSession = vi.fn(async () => {});
  const deps = {
    store,
    legDeps: async (_a: typeof actor, l: LegStoredIntent) => ({
      snapshot: async () => ({ kind: "confirmed" as const, value: l.snapshot }),
      client: n3BillingClient,
      now: () => new Date(),
      invalidateSession,
      lookupExactReference: async () => ({
        kind: "confirmed" as const,
        value: exists.has(l.id) && fault.timeoutLeg !== l.id ? [ids.get(l.id)!] : [],
      }),
    }),
  };
  const step = (legId: string, action = "post_bill") => {
    const leg = stay.legs.find((l) => l.id === legId)!;
    return runSourceBillStep(
      actor,
      {
        legId,
        planDigest: stay.plan.digest,
        expectedRevision: leg.revision,
        action:
          action === "post_bill"
            ? {
                action: "post_bill",
                clientRequestId: legId,
                intentId: legId,
                snapshotDigest: leg.snapshot.digest,
                expectedRevision: leg.revision,
              }
            : {
                action: action as "receive_balance",
                intentId: legId,
                expectedRevision: leg.revision,
                selectedAccountId: "11111111-1111-4111-8111-111111111111",
              },
      },
      deps,
    );
  };
  return { stay, writes, rpcCalls, fault, fetch, deps, step, invalidateSession };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-12T00:00:00Z");
  vi.spyOn(gates, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: "c".repeat(64),
      allocationMode: "preserve_existing",
      billTarget: "same_id_INV",
    },
  }));
  vi.spyOn(sourceGates, "sourceBillingDocumentGate").mockReturnValue({
    kind: "confirmed",
    value: { documentType: "cash_sale", postToAR: true, evidenceHash: "a".repeat(64) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("one action per billing leg", () => {
  it("first_bill_success_second_timeout_no_repost; GET recovery retains first", async () => {
    const f = fixture();
    await f.step(source);
    f.fault.timeoutLeg = guest;
    await f.step(guest);
    f.fault.timeoutLeg = "";
    const view = await reconcileSourceBills(actor, f.stay.plan.digest, f.deps);
    expect(f.writes).toEqual([source, guest]);
    expect(view.legs.map((l) => l.view.bill?.code)).toEqual(["CS-ASSIGNED-A", "CS-ASSIGNED-B"]);
    await f.step(source);
    await f.step(guest);
    expect(f.writes).toEqual([source, guest]);
    expect(view.canClose).toBe(false);
  });
  it("concurrent_double_click_one_claim_per_leg", async () => {
    const f = fixture();
    await Promise.all([f.step(guest), f.step(guest)]);
    expect(f.writes).toEqual([guest]);
    expect(f.stay.legs[1].dispatches).toHaveLength(1);
  });
  it.each(["receive_balance", "apply_deposits", "apply_balance"])(
    "source %s rejected before client or claim",
    async (action) => {
      const f = fixture();
      await expect(f.step(source, action)).rejects.toThrow("source_billing_guest_action_required");
      expect(f.writes).toEqual([]);
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it("guest_leg_can_receive_when_contract_accepted against only its RM40 balance", async () => {
    const f = fixture();
    await f.step(guest);
    const v = await f.step(guest, "receive_balance");
    expect(f.writes).toEqual([guest, guest]);
    expect(v.legs[1].view.blockers).toEqual([]);
    expect(v.legs[1].view.receipts).toMatchObject([
      { code: "OR-ASSIGNED-GUEST", amountCents: 4000, remainderCents: 4000 },
    ]);
    expect(v.legs[0].view.bill).toBeNull();
    expect(v.canClose).toBe(false);
  });
  it("source writes remain disabled until the separate debtor contract is accepted", async () => {
    vi.mocked(sourceGates.sourceBillingDocumentGate).mockReturnValue({
      kind: "unavailable",
      code: "n3_source_billing_contract_unverified",
    });
    const f = fixture();
    const v = await f.step(source);
    expect(f.writes).toEqual([]);
    expect(v.legs[0].view.blockers).toContain("n3_source_billing_contract_unverified");
  });
  it("401_ends_session_preserves_unknown without another create or sibling N3 read", async () => {
    const f = fixture();
    await f.step(source);
    f.fault.status = 401;
    f.fetch.mockClear();
    const v = await f.step(guest);
    expect(f.invalidateSession).toHaveBeenCalled();
    expect(f.writes).toEqual([source, guest]);
    expect(f.stay.legs[1].dispatches[0].outcome?.kind).toBe("unknown");
    expect(v.blockers).toContain("n3_session_expired");
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(0);
  });
  it("background status is GET-only and different returned codes remain honest", async () => {
    const f = fixture();
    await f.step(source);
    f.rpcCalls.length = 0;
    const count = f.writes.length;
    const v = await readSourceBillingStatus(actor, f.deps);
    expect(f.writes).toHaveLength(count);
    expect(f.rpcCalls.every((n) => n.endsWith("_read"))).toBe(true);
    expect(v.legs[0]).toMatchObject({
      hhNumber: "SI261000001",
      view: { bill: { code: "CS-ASSIGNED-A" } },
    });
  });
  it("wrong plan, stale revision, sibling intent and per-leg close cannot dispatch", async () => {
    const f = fixture(),
      l = f.stay.legs[1];
    await expect(
      runSourceBillStep(
        actor,
        {
          legId: guest,
          planDigest: "d".repeat(64),
          expectedRevision: "1",
          action: {
            action: "post_bill",
            intentId: guest,
            clientRequestId: guest,
            snapshotDigest: l.snapshot.digest,
            expectedRevision: "1",
          },
        },
        f.deps,
      ),
    ).rejects.toThrow("settlement_scope_mismatch");
    await expect(
      runSourceBillStep(
        actor,
        {
          legId: guest,
          planDigest: f.stay.plan.digest,
          expectedRevision: "1",
          action: { action: "receive_balance", intentId: source, expectedRevision: "1" },
        },
        f.deps,
      ),
    ).rejects.toThrow("settlement_scope_mismatch");
    await expect(f.step(guest, "close")).rejects.toThrow("source_billing_whole_stay_required");
    expect(f.writes).toEqual([]);
  });
  it("selected action errors stay visible after the status refresh", async () => {
    const f = fixture(),
      l = f.stay.legs[1];
    const v = await runSourceBillStep(
      actor,
      {
        legId: guest,
        planDigest: f.stay.plan.digest,
        expectedRevision: l.revision,
        action: {
          action: "post_bill",
          intentId: guest,
          clientRequestId: guest,
          snapshotDigest: "d".repeat(64),
          expectedRevision: l.revision,
        },
      },
      f.deps,
    );
    expect(v.legs[1].view.blockers).toContain("settlement_snapshot_changed");
    expect(v.blockers).toContain("settlement_snapshot_changed");
    expect(f.writes).toEqual([]);
  });
  it("reconciliation returns the aggregate revision after every saved leg proof", async () => {
    const f = fixture();
    f.fault.timeoutLeg = guest;
    await f.step(guest);
    f.fault.timeoutLeg = "";
    const result = await reconcileSourceBills(actor, f.stay.plan.digest, f.deps);
    const current = await f.deps.store.read(actor);
    expect(result.revision).toBe(current!.revision);
    expect(result.legs[1].view.revision).toBe(current!.legs[1].revision);
  });
  it("sibling bill identity cannot satisfy the guest evidence", async () => {
    const f = fixture();
    await f.step(source);
    f.fault.siblingBill = true;
    const v = await f.step(guest);
    expect(v.legs[1].view.bill).toBeNull();
    expect(v.legs[1].view.blockers.length).toBeGreaterThan(0);
    expect(v.canClose).toBe(false);
  });
});
