import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettlementCard } from "../../components/SettlementCard";
import { hasPermission, type HotelRole } from "../rbac";
import { SESSION_QUERY_KEY } from "../session-client";
import { WorkspaceProvider, useWorkspace } from "../workspace-context";
import type { WorkspaceStore } from "../workspace-tabs";
import type { SettlementView } from "../settlement";

const navigation = vi.hoisted(() => ({ path: "", subscribe: () => () => {} }));
vi.mock("@tanstack/react-router", async (load) => ({
  ...(await load<object>()),
  useLocation: () => ({ pathname: navigation.path, search: {} }),
  useRouter: () => ({ subscribe: navigation.subscribe }),
}));
const domPackage = process.env.HH_UI_DOM_PACKAGE;
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const cash = "11111111-1111-6111-f111-111111111111",
  card = "22222222-2222-6222-f222-222222222222";
describe.skipIf(!domPackage)("Prepare Checkout actual payment entry", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow }, createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>,
    window: DomWindow,
    qc: QueryClient,
    container: HTMLElement,
    store: WorkspaceStore;
  let posts: Array<{ path: string; body: Record<string, unknown> }>,
    complete: ((r: Response) => void) | null;
  let defer: boolean, split: boolean, balance: number, revision: string;
  let automaticMatch: boolean, depositPending: boolean, matchFailure: boolean;
  const matched = new Set<string>();
  let matchingStatus: "confirmed" | "needs_review", matchingRemainder: number;
  let beforeFreeze: boolean, postStatus: number, accountStatus: number;
  const settled = new Set<string>();
  function view(id: string): SettlementView {
    return {
      tenantId: "fixture-tenant",
      reservationId: id,
      intentId: beforeFreeze ? null : ids[0],
      snapshotDigest: "d".repeat(64),
      revision,
      state: beforeFreeze
        ? null
        : matched.has(id)
          ? "settled"
          : settled.has(id)
            ? "balance_dispatched"
            : "awaiting_payment",
      currency: "MYR",
      bill: beforeFreeze
        ? null
        : {
            id: ids[1],
            code: "SYNTHETIC-BILL",
            documentDate: "2026-10-14",
            totalCents: 111455,
            outstandingCents: matched.has(id) ? 0 : balance,
          },
      receipts: settled.has(id)
        ? [
            {
              id: "33333333-3333-4333-8333-333333333333",
              code: "OR-SYNTHETIC",
              documentDate: "2026-10-14",
              amountCents: balance,
              allocatedCents: matched.has(id) ? balance : 0,
              remainderCents: matched.has(id) ? 0 : balance,
            },
          ]
        : [],
      blockers: [],
      allowedActions: beforeFreeze
        ? ["post_bill"]
        : matched.has(id)
          ? ["close"]
          : settled.has(id)
            ? automaticMatch
              ? ["apply_balance"]
              : []
            : depositPending
              ? ["apply_deposits"]
              : ["receive_balance"],
      verifiedAt: "2026-10-14T02:00:00Z",
      canSplitPayment: split,
    };
  }
  beforeAll(async () => {
    ({ Window: WindowCtor } = await import(/* @vite-ignore */ domPackage!));
  });
  beforeEach(async () => {
    window = new WindowCtor();
    for (const key of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLSelectElement",
      "Event",
      "MouseEvent",
    ] as const)
      vi.stubGlobal(key, key === "window" ? window : window[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", window.requestAnimationFrame.bind(window));
    vi.stubGlobal("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
    ({ createRoot } = await import("react-dom/client"));
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      role: "owner",
      housekeepingMode: "simple",
      tenant: { tenantId: "fixture-tenant" },
      user: { n3UserKey: "fixture-owner" },
    });
    posts = [];
    complete = null;
    defer = false;
    split = true;
    balance = 106455;
    revision = "3";
    beforeFreeze = false;
    postStatus = 200;
    accountStatus = 200;
    matchingStatus = "confirmed";
    matchingRemainder = 0;
    settled.clear();
    matched.clear();
    automaticMatch = false;
    depositPending = false;
    matchFailure = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (path === "/api/hotel/payment-accounts")
          if (accountStatus !== 200)
            return Response.json({ error: "accounts_unavailable" }, { status: accountStatus });
        if (path === "/api/hotel/payment-accounts")
          return Response.json({
            accounts: [
              {
                id: cash,
                code: "CASH",
                name: "CashNote",
                kind: "cash",
                label: "CashNote",
                show: true,
              },
              {
                id: card,
                code: "CARD",
                name: "Credit card",
                kind: "bank",
                label: "Credit card",
                show: true,
              },
            ],
          });
        const id = path.split("/")[4];
        if (init?.method === "POST") {
          posts.push({ path, body: JSON.parse(String(init.body)) });
          if (postStatus !== 200)
            return Response.json({ error: "settlement_unavailable" }, { status: postStatus });
          if (defer)
            return new Promise<Response>((resolve) => {
              complete = resolve;
            });
          if (path.endsWith("/external-matching-check"))
            return Response.json({
              tenantId: "fixture-tenant",
              reservationId: id,
              intentId: ids[0],
              status: matchingStatus,
              code:
                matchingStatus === "confirmed"
                  ? "external_matching_observed"
                  : "receipt_allocation_mismatch",
              checkedAt: "2026-10-14T02:00:00Z",
              observations: 2,
              persistenceProven: false,
              billOutstandingCents: 0,
              documents: [{ id: ids[1], code: "MATCHED-SYNTHETIC-BILL", kind: "bill" }],
              attempts: [],
              responses: [],
              checks: [],
              externalMatching: {
                provenance: "external_n3_matching",
                canClose: false,
                matches: [],
                receiptObservations: [
                  { receiptId: cash, remainderCents: matchingRemainder, refundCents: 0 },
                ],
              },
            });
          const action = posts.at(-1)!.body.action;
          if (action === "apply_balance") {
            if (matchFailure)
              return Response.json({ error: "settlement_unavailable" }, { status: 503 });
            matched.add(id);
            revision = String(BigInt(revision) + 1n);
          } else if (action === "apply_deposits") depositPending = false;
          else {
            settled.add(id);
            revision = String(BigInt(revision) + 1n);
          }
          return Response.json(view(id));
        }
        if (path.endsWith("/settlement")) return Response.json(view(id));
        throw new Error(`Unexpected fetch ${path}`);
      }),
    );
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      complete?.(Response.json({ error: "settlement_unavailable" }, { status: 503 }));
    });
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function Capture() {
    store = useWorkspace()!.store;
    return null;
  }
  async function show(id: string) {
    navigation.path = `/reservations/${id}/checkout`;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            WorkspaceProvider,
            { children: null },
            createElement(Capture),
            createElement(SettlementCard, {
              key: id,
              reservationId: id,
              owner: hasPermission(
                (qc.getQueryData(SESSION_QUERY_KEY) as { role: HotelRole }).role,
                "hotel:checkout:write",
              ),
            }),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  async function click(text: string) {
    // Query notifications are scheduled independently of render. A fixed20ms
    // sleep could click a still-disabled button under full-suite load and then
    // incorrectly test a pending action that was never submitted.
    const find = () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (find() && !find()!.disabled) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const b = find();
    expect(b, text).toBeDefined();
    expect(b!.disabled, `${text} must be ready before simulating a click`).toBe(false);
    await act(async () => b!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  }
  async function enter(n: number, type: "select" | "input", value: string) {
    const find = () => container.querySelectorAll<HTMLSelectElement | HTMLInputElement>(type)[n];
    const ready = () => {
      const e = find();
      return (
        e &&
        !e.disabled &&
        !e.closest("fieldset")?.disabled &&
        (type !== "select" ||
          [...(e as HTMLSelectElement).options].some((option) => option.value === value))
      );
    };
    // Account options can arrive after the card. Selecting an absent option
    // produces an empty native value and does not model an available user action.
    for (let attempt = 0; attempt < 100 && !ready(); attempt++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    const e = find();
    expect(e).toBeDefined();
    expect(Boolean(ready()), `${type} value must be available before entry`).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        type === "select" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(e, value);
      e.dispatchEvent(new window.Event(type === "select" ? "change" : "input", { bubbles: true }));
    });
  }
  async function confirm() {
    const e = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(e).not.toBeNull();
    await act(async () => e.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  }
  it("receives payment after delayed account options finish loading", async () => {
    const normalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("payment-accounts"))
        await new Promise((resolve) => setTimeout(resolve, 120));
      return normalFetch(input, init);
    });
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      action: "receive_balance",
      paymentLines: [{ accountId: cash, amountCents: 106455 }],
    });
  });
  it("shows the three steps and disables collection until Match Deposit is verified", async () => {
    depositPending = true;
    await show(ids[0]);
    expect(container.textContent).toContain("1. Post to N3");
    expect(container.textContent).toContain("2. Match Deposit");
    expect(container.textContent).toContain("3. Receive Payment");
    const receive = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Receive Payment",
    );
    expect(receive).toBeDefined();
    expect(receive!.disabled).toBe(true);
    expect(container.querySelector("select")).toBeNull();
    await click("Match Deposit");
    expect(posts.map((p) => p.body.action)).toEqual(["apply_deposits"]);
    expect(container.querySelector("select")).not.toBeNull();
  });
  it("one Receive Payment click saves the receipt then matches it with the returned revision", async () => {
    automaticMatch = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    expect(posts.map((p) => p.body.action)).toEqual(["receive_balance", "apply_balance"]);
    expect(posts[1].body).toEqual({
      action: "apply_balance",
      intentId: ids[0],
      expectedRevision: "4",
    });
    expect(container.textContent).toContain("Complete Checkout");
  });
  it("a saved payment with failed matching is recovered without collecting it again", async () => {
    automaticMatch = true;
    matchFailure = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    expect(posts.map((p) => p.body.action)).toEqual(["receive_balance", "apply_balance"]);
    expect(container.textContent).toContain("Payment saved; matching needs checking");
    expect(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Receive Payment")
        ?.disabled ?? true,
    ).toBe(true);
    await show(ids[0]);
    expect(posts).toHaveLength(2);
  });
  it("does not match under a changed signed-in user after a late payment response", async () => {
    automaticMatch = true;
    defer = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    const late = complete!;
    await act(async () => {
      qc.setQueryData(SESSION_QUERY_KEY, {
        authenticated: true,
        role: "owner",
        housekeepingMode: "simple",
        tenant: { tenantId: "fixture-tenant" },
        user: { n3UserKey: "another-owner" },
      });
    });
    settled.add(ids[0]);
    revision = "4";
    await act(async () => {
      late(Response.json(view(ids[0])));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts.map((p) => p.body.action)).toEqual(["receive_balance"]);
  });
  it("a double click submits one balance receipt and one matching request", async () => {
    automaticMatch = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Receive Payment",
    )!;
    await act(async () => {
      button.click();
      button.click();
      await new Promise((r) => setTimeout(r, 25));
    });
    expect(posts.map((p) => p.body.action)).toEqual(["receive_balance", "apply_balance"]);
  });
  it("does not automatically match a saved payment on page load", async () => {
    automaticMatch = true;
    settled.add(ids[0]);
    await show(ids[0]);
    expect(container.textContent).toContain("Apply received payment");
    expect(posts).toHaveLength(0);
  });
  it("does not continue payment matching after changing bookings", async () => {
    automaticMatch = true;
    defer = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    const late = complete!;
    await show(ids[1]);
    settled.add(ids[0]);
    await act(async () => {
      late(Response.json(view(ids[0])));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts.map((p) => p.body.action)).toEqual(["receive_balance"]);
  });
  it("Front Desk can enter and submit actual payment through checkout permission", async () => {
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      role: "front_desk",
      housekeepingMode: "simple",
      tenant: { tenantId: "fixture-tenant" },
      user: { n3UserKey: "fixture-staff" },
    });
    await show(ids[0]);
    expect(container.textContent).toContain("Receive Payment");
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      action: "receive_balance",
      paymentLines: [{ accountId: cash, amountCents: 106455 }],
    });
  });
  it("offers accountant matching verification on the same checkout screen without payment dispatch", async () => {
    await show(ids[0]);
    expect(container.textContent).toContain("Match in N3");
    await click("Check N3 matching");
    expect(posts).toEqual([
      {
        path: `/api/hotel/reservations/${ids[0]}/external-matching-check`,
        body: { intentId: ids[0] },
      },
    ]);
    expect(container.textContent).toContain("N3 matching verified for this booking");
    expect(container.textContent).toContain("Complete Checkout still requires");
  });
  it("cancels a read-only matching check when navigating and never shows the old result on another booking", async () => {
    defer = true;
    await show(ids[0]);
    await click("Check N3 matching");
    const late = complete!;
    await show(ids[1]);
    await act(async () => {
      late(
        Response.json({
          tenantId: "fixture-tenant",
          reservationId: ids[0],
          intentId: ids[0],
          status: "confirmed",
          code: "external_matching_observed",
          externalMatching: { provenance: "external_n3_matching", canClose: false },
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).not.toContain("N3 matching verified");
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toContain(ids[0]);
  });
  it("keeps exact saved document references visible when matching needs review", async () => {
    matchingStatus = "needs_review";
    await show(ids[0]);
    await click("Check N3 matching");
    expect(container.textContent).toContain("MATCHED-SYNTHETIC-BILL");
    expect(container.textContent).toContain("do not collect again");
  });
  it("shows retained receipt surplus and accountant review rather than hiding it behind matched success", async () => {
    matchingRemainder = 5000;
    await show(ids[0]);
    await click("Check N3 matching");
    expect(container.textContent).toContain("remaining MYR 50.00");
    expect(container.textContent).toContain("requires accountant review");
  });
  it("submits one reviewed cash/card receipt intent with exact cents", async () => {
    await show(ids[0]);
    expect(posts).toHaveLength(0);
    await enter(0, "select", cash);
    await enter(0, "input", "532.27");
    await click("Add payment method");
    await enter(1, "select", card);
    await enter(1, "input", "532.28");
    await confirm();
    await click("Receive Payment");
    expect(posts).toEqual([
      {
        path: `/api/hotel/reservations/${ids[0]}/settlement/step`,
        body: {
          action: "receive_balance",
          intentId: ids[0],
          expectedRevision: "3",
          paymentLines: [
            { accountId: cash, amountCents: 53227 },
            { accountId: card, amountCents: 53228 },
          ],
        },
      },
    ]);
  });
  it("invalidates confirmation when the entered amount or outstanding revision changes", async () => {
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await enter(0, "input", "1064.54");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(
      false,
    );
    expect(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Receive Payment")!
        .disabled,
    ).toBe(true);
    await enter(0, "input", "1064.55");
    await confirm();
    revision = "4";
    balance = 106400;
    await click("Refresh");
    await show(ids[0]);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(
      false,
    );
    expect(posts).toHaveLength(0);
  });
  it("keeps payment drafts, in-flight dispatch and failed recovery on the original booking", async () => {
    defer = true;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "1064.55");
    await confirm();
    await click("Receive Payment");
    expect(posts).toHaveLength(1);
    expect(complete).toBeTypeOf("function");
    await show(ids[1]);
    expect(container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe("");
    await show(ids[0]);
    expect(store.close(`reservation:${ids[0]}`, true)).toBe(false);
    expect(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Receive Payment")
        ?.disabled ?? true,
    ).toBe(true);
    await show(ids[1]);
    await act(async () => {
      complete!(Response.json({ error: "settlement_unavailable" }, { status: 503 }));
      await new Promise((r) => setTimeout(r, 20));
    });
    await show(ids[0]);
    expect(container.textContent).toContain("do not repeat the payment");
    expect(posts).toHaveLength(1);
  });
  it("shows the independently closed split gate without submitting", async () => {
    split = false;
    await show(ids[0]);
    await enter(0, "select", cash);
    await enter(0, "input", "532.27");
    await click("Add payment method");
    await enter(1, "select", card);
    await enter(1, "input", "532.28");
    expect(container.textContent).toContain("Split payment posting requires N3 verification");
    expect(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Receive Payment")!
        .disabled,
    ).toBe(true);
    expect(posts).toHaveLength(0);
  });
  it("recovers a failed confirmation only after fresh authoritative no-intent status and keeps its request key", async () => {
    beforeFreeze = true;
    postStatus = 503;
    await show(ids[0]);
    await click("Confirm Folio & Post to N3");
    const original = posts[0].body.clientRequestId;
    expect(
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Confirm Folio & Post to N3",
      )!.disabled,
    ).toBe(true);
    postStatus = 200;
    await click("Refresh");
    await show(ids[0]);
    expect(
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Confirm Folio & Post to N3",
      )!.disabled,
    ).toBe(false);
    await click("Confirm Folio & Post to N3");
    expect(posts).toHaveLength(2);
    expect(posts[1].body.clientRequestId).toBe(original);
  });
  it("Refresh reloads failed scoped payment account choices", async () => {
    accountStatus = 502;
    await show(ids[0]);
    expect(container.textContent).toContain("Payment accounts are unavailable");
    accountStatus = 200;
    await click("Refresh");
    await show(ids[0]);
    expect(container.textContent).not.toContain("Payment accounts are unavailable");
    expect(container.querySelector("select")!.textContent).toContain("CashNote");
  });
});
