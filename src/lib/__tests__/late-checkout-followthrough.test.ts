import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lateCheckoutLocal,
  operationErrorMessage,
  useRequestOperation,
  useDecideOperation,
} from "../operations-client";
import { validateLateCheckoutWindow } from "../reservation-operations.server";
import { LateCheckoutFields } from "../../components/ReservationOperations";
import { ReceiptRequestCard } from "../../components/ReceiptApprovalQueue";
import type { ReceiptControlRequestDTO } from "../receipt-controls";
import { receiptSnapshot } from "./fixtures/receipt-controls";

afterEach(() => vi.unstubAllGlobals());

describe("Late Checkout on the saved departure day", () => {
  it("explains the different-day refusal with Extend Stay guidance, not a retry", () => {
    const result = validateLateCheckoutWindow({
      expectedCheckOutLocal: "2026-10-03T13:28",
      departureDate: "2026-09-25",
      standardCheckOutTime: "12:00",
      timezone: "Asia/Kuala_Lumpur",
    });
    expect(result).toEqual({ ok: false, code: "late_checkout_out_of_range" });
    if (!result.ok) {
      expect(operationErrorMessage(result.code)).toMatch(/departure day/i);
      expect(operationErrorMessage(result.code)).toMatch(/Extend Stay/i);
      expect(operationErrorMessage(result.code)).not.toMatch(/try again/i);
    }
  });

  it("explains why checkout at the standard time is refused", () => {
    expect(operationErrorMessage("late_checkout_not_later")).toMatch(/later.*standard checkout/i);
  });

  it("combines the chosen time with the booking date for server timezone resolution", () => {
    const local = lateCheckoutLocal("2026-09-25", "13:28");
    expect(local).toBe("2026-09-25T13:28");
    expect(
      validateLateCheckoutWindow({
        expectedCheckOutLocal: local!,
        departureDate: "2026-09-25",
        standardCheckOutTime: "12:00",
        timezone: "Asia/Kuala_Lumpur",
      }),
    ).toEqual({ ok: true, utcIso: "2026-09-25T05:28:00.000Z" });
  });

  it.each(["", "24:00", "13:60", "2026-10-03T13:28", "13:28+08:00"])(
    "never submits malformed or date-bearing time %j",
    (time) => {
      expect(lateCheckoutLocal("2026-09-25", time)).toBeNull();
    },
  );

  it("does not manufacture a valid date from an invalid booking date", () => {
    expect(lateCheckoutLocal("2026-02-30", "13:28")).toBeNull();
  });

  it("renders the Malaysian departure date with a time-only field and extra-night guidance", () => {
    const html = renderToStaticMarkup(
      createElement(LateCheckoutFields, {
        departureDate: "2026-09-25",
        time: "13:28",
        reason: "Guest leaving later",
        onTimeChange: () => {},
        onReasonChange: () => {},
      }),
    );
    expect(html).toContain("25/09/2026");
    expect(html).toContain('type="time"');
    expect(html).toContain('value="13:28"');
    expect(html).toContain("Property local time");
    expect(html).toContain("Extend Stay");
    expect(html).not.toContain('type="datetime-local"');
  });
});

const dependencyKeys = [
  ["reservations", "detail", "t1", "r1"],
  ["reservation-calendar", "t1", "2026-09"],
  ["departures", "t1", "bucket=all"],
  ["checkout-preview", "r1"],
  ["folio", "tenant", "r1"],
  ["housekeeping", "board", "t1"],
];

function operationHarness(qc: QueryClient, kind: "request" | "decision") {
  let request: ReturnType<typeof useRequestOperation> | undefined;
  let decision: ReturnType<typeof useDecideOperation> | undefined;
  function Harness() {
    request = useRequestOperation("r1");
    decision = useDecideOperation("r1");
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
  return kind === "request"
    ? () =>
        request!.mutateAsync({
          operationType: "late_checkout",
          payload: {
            expectedCheckOutLocal: "2026-09-25T13:28",
            reason: "Leaving later",
          },
          clientRequestId: "test-client-request",
        })
    : () =>
        decision!.mutateAsync({
          requestId: "op1",
          decision: "approve",
          note: null,
          clientRequestId: "test-client-decision",
        });
}

describe("Operation results refresh all dependent views", () => {
  it("refreshes an already mounted checkout reader after a successful operation", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = ["checkout-preview", "r1"];
    qc.setQueryData(key, { amount: 50, expectedCheckOutAt: "2026-09-25T04:00:00.000Z" });
    const observer = new QueryObserver(qc, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => ({ amount: 50, expectedCheckOutAt: "2026-09-25T05:28:00.000Z" }),
    });
    const unsubscribe = observer.subscribe(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ requestId: "op1", state: "applied" })),
    );
    try {
      await operationHarness(qc, "request")();
      await vi.waitFor(() => {
        expect(qc.getQueryData(key)).toEqual({
          amount: 50,
          expectedCheckOutAt: "2026-09-25T05:28:00.000Z",
        });
      });
    } finally {
      unsubscribe();
      observer.destroy();
      qc.clear();
    }
  });

  it.each(["request", "decision"] as const)(
    "refreshes dependent caches after successful %s",
    async (kind) => {
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      for (const key of dependencyKeys) qc.setQueryData(key, { amount: 50 });
      qc.setQueryData(["financial-reporting", "t1:owner", "2026-10"], { amount: 50 });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ requestId: "op1", state: "applied" })),
      );
      await operationHarness(qc, kind)();
      for (const key of dependencyKeys) {
        expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
        expect(qc.getQueryData(key)).toEqual({ amount: 50 });
      }
      expect(qc.getQueryState(["financial-reporting", "t1:owner", "2026-10"])?.isInvalidated).toBe(
        false,
      );
      qc.clear();
    },
  );

  it("a refused operation does not change or refresh saved financial/departure data", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData(["departures", "t1", "bucket=all"], { amount: 50 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "late_checkout_out_of_range" }, { status: 400 })),
    );
    await expect(operationHarness(qc, "request")()).rejects.toMatchObject({
      code: "late_checkout_out_of_range",
    });
    expect(qc.getQueryState(["departures", "t1", "bucket=all"])?.isInvalidated).toBe(false);
    expect(qc.getQueryData(["departures", "t1", "bucket=all"])).toEqual({ amount: 50 });
    qc.clear();
  });
});

function receiptRequest(state: ReceiptControlRequestDTO["state"]): ReceiptControlRequestDTO {
  const original = receiptSnapshot();
  return {
    id: "request-1",
    reservationId: "r1",
    bookingReference: "BK-TEST",
    depositId: "d1",
    reason: "Guest request",
    requestedByLabel: "Owner",
    requestedAt: "2026-10-03T05:24:00Z",
    state,
    version: 2,
    original,
    proposal: {
      kind: "correction",
      amountCents: 6000,
      accountId: original.paymentLines[0]!.accountId,
      contact: original.contact,
    },
    comparison: {
      fields: [{ label: "Amount", original: "RM50.00", requested: "RM60.00" }],
      depositDeltaCents: 1000,
      balanceDeltaCents: -1000,
    },
    executionMode: "manual",
    decidedByLabel: "Owner",
    decidedAt: "2026-10-03T05:33:00Z",
    selfApproved: true,
    canApprove: false,
    canReject: false,
    canVerify: state === "approved_awaiting_n3",
    canRecover: false,
    outcomeMessage: "Approved. Complete the change in N3, then verify.",
    alert: { status: "disabled", lastError: null },
  };
}

describe("Receipt approval copy distinguishes authorized and verified money", () => {
  it("shows approval as a requested change and tells the Owner what makes totals update", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptRequestCard, {
        r: receiptRequest("approved_awaiting_n3"),
      }),
    );
    expect(html).toContain("Requested change:");
    expect(html).toMatch(/Totals update only after verification/i);
    expect(html).toContain("Verify N3 change");
    expect(html).not.toContain("Verified change:");
  });

  it("only calls a completed request verified and does not offer another Verify action", () => {
    const r = { ...receiptRequest("applied"), outcomeMessage: "N3 change verified." };
    const html = renderToStaticMarkup(createElement(ReceiptRequestCard, { r }));
    expect(html).toContain("Verified change:");
    expect(html).not.toContain("Verify N3 change");
    expect(html).not.toMatch(/Totals update only after verification/i);
  });
});
