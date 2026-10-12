import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  success: null as null | ((value: unknown) => Promise<void>),
  scope: "owner",
}));
vi.mock("../session-client", () => ({
  useSessionMe: () => ({
    data: {
      authenticated: true,
      role: state.scope,
      tenant: { tenantId: "t" },
      user: { n3UserKey: "u" },
    },
  }),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<object>()),
  useMutation: (options: {
    mutationKey: string[];
    onSuccess: (value: unknown) => Promise<void>;
  }) => {
    if (options.mutationKey[2] === "request") state.success = options.onSuccess;
    return { isPending: false, mutate: () => {} };
  },
}));
vi.mock("../deposits-client", () => ({ usePaymentAccounts: () => ({ data: { accounts: [] } }) }));
vi.mock("../receipt-controls-client", async (original) => ({
  ...(await original<object>()),
  getReceiptOriginal: async () => ({
    original: {
      amountCents: 7000,
      currency: "MYR",
      accountId: "b",
      contact: { customerName: "", remark1: "", remark2: "", remark3: "", remark4: "" },
    },
  }),
}));
import { ReceiptControlRequestDialog } from "../../components/ReceiptControlRequestDialog";
import type { DepositDTO } from "../deposits-client";
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("reservation completion after proven direct correction", () => {
  let WindowCtor: { new (): Window & typeof globalThis & { happyDOM: { close(): Promise<void> } } },
    window: InstanceType<typeof WindowCtor>,
    root: ReturnType<typeof import("react-dom/client").createRoot>,
    qc: QueryClient;
  const close = vi.fn();
  const applied = {
    request: {
      id: "saved",
      state: "applied",
      automation: { generation: 2 },
      canApply: false,
      canCheckResult: false,
    },
    outcome: "applied",
    code: "verified",
  };
  beforeAll(async () => {
    ({ Window: WindowCtor } = await import(/* @vite-ignore */ domPackage!));
  });
  beforeEach(async () => {
    window = new WindowCtor();
    for (const key of ["window", "document", "navigator", "HTMLElement"] as const)
      vi.stubGlobal(key, key === "window" ? window : window[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.scope = "owner";
    close.mockClear();
    qc = new QueryClient();
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(ReceiptControlRequestDialog, {
            reservationId: "r",
            deposit: { id: "d", amount: 70, currency: "MYR" } as DepositDTO,
            kind: "correction",
            onClose: close,
          }),
        ),
      ),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
  });
  it("closes automatically only after all reader refreshes finish", async () => {
    let finish!: () => void;
    const shared = new Promise<void>((r) => {
      finish = r;
    });
    vi.spyOn(qc, "invalidateQueries").mockImplementation(() => shared);
    const done = state.success!(applied);
    await act(async () => Promise.resolve());
    expect(close).not.toHaveBeenCalled();
    finish();
    await act(async () => done);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("discards pre-commit deposit and folio reads before closing", async () => {
    const oldResolvers: Array<(value: number) => void> = [];
    const freshResolvers: Array<(value: number) => void> = [];
    const observers = ["deposits", "folio"].map((prefix) => {
      const key = [prefix, "r"];
      qc.setQueryData(key, 70);
      let calls = 0;
      const observer = new QueryObserver(qc, {
        queryKey: key,
        staleTime: Infinity,
        retry: false,
        queryFn: () =>
          new Promise<number>((resolve) => {
            (calls++ === 0 ? oldResolvers : freshResolvers).push(resolve);
          }),
      });
      const unsubscribe = observer.subscribe(() => {});
      void observer.refetch();
      return { key, unsubscribe };
    });
    expect(oldResolvers).toHaveLength(2);
    const done = state.success!(applied);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(freshResolvers).toHaveLength(2);
    oldResolvers.forEach((resolve) => resolve(70));
    await act(async () => Promise.resolve());
    expect(close).not.toHaveBeenCalled();
    freshResolvers.forEach((resolve) => resolve(66));
    await act(async () => done);
    expect(observers.map(({ key }) => qc.getQueryData(key))).toEqual([66, 66]);
    expect(close).toHaveBeenCalledOnce();
    observers.forEach(({ unsubscribe }) => unsubscribe());
  });
  it("refresh failure never closes the correction dialog", async () => {
    vi.spyOn(qc, "invalidateQueries").mockRejectedValue(new Error("offline"));
    await act(async () => state.success!(applied));
    expect(close).not.toHaveBeenCalled();
  });
});
