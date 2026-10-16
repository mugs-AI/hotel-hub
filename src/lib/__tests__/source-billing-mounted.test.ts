import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourceBillingCard } from "../../components/SourceBillingCard";
import { SESSION_QUERY_KEY } from "../session-client";
import { actor, plan } from "./fixtures/source-billing";
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("mounted source bill review and posting", () => {
  let win: Window & typeof globalThis & { happyDOM: { close(): Promise<void> } },
    root: import("react-dom/client").Root,
    container: HTMLElement,
    qc: QueryClient;
  let posts: { url: string; body: Record<string, unknown> }[],
    canConfirm: boolean,
    digest: string,
    defer: boolean,
    release: (r: Response) => void,
    gets: number,
    blocked: boolean,
    stage: "review" | "deposit" | "payment" | "received" | "settled",
    matchFailure: boolean;
  const ids = [actor.reservationId, "88888888-8888-4888-8888-888888888888"];
  function data(id = ids[0]) {
    const p = plan();
    if (stage !== "review")
      return {
        tenantId: actor.tenantId,
        reservationId: id,
        legacy: false,
        review: null,
        blockers: [],
        stay: {
          reservationId: id,
          revision: "1",
          planDigest: digest,
          canClose: false,
          blockers: [],
          legs: p.legs.map((l, i) => ({
            legId: l.legId,
            kind: l.kind,
            hhNumber: `SI26100000${i + 1}`,
            view: {
              tenantId: actor.tenantId,
              reservationId: id,
              intentId: l.legId,
              snapshotDigest: l.snapshot.digest,
              revision: stage === "received" ? "3" : stage === "settled" ? "4" : "2",
              state:
                l.kind === "source_room"
                  ? "bill_verified"
                  : stage === "received"
                    ? "balance_dispatched"
                    : stage === "settled"
                      ? "settled"
                      : "awaiting_payment",
              currency: "MYR",
              bill: {
                id: l.legId,
                code: l.kind === "guest" ? "CS-GUEST" : "CS-SOURCE",
                documentDate: "2026-10-15",
                totalCents: l.snapshot.totalCents,
                outstandingCents:
                  l.kind === "guest" && stage === "settled" ? 0 : l.snapshot.totalCents,
              },
              receipts:
                l.kind === "guest" && ["received", "settled"].includes(stage)
                  ? [
                      {
                        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                        code: "OR-BALANCE",
                        documentDate: "2026-10-16",
                        amountCents: l.snapshot.totalCents,
                        allocatedCents: stage === "settled" ? l.snapshot.totalCents : 0,
                        remainderCents: stage === "settled" ? 0 : l.snapshot.totalCents,
                      },
                    ]
                  : [],
              blockers: [],
              allowedActions:
                l.kind === "source_room" || stage === "settled"
                  ? []
                  : [
                      stage === "deposit"
                        ? "apply_deposits"
                        : stage === "payment"
                          ? "receive_balance"
                          : "apply_balance",
                    ],
              verifiedAt: "2026-10-15T23:00:00Z",
              canSplitPayment: false,
            },
          })),
        },
      };
    return {
      tenantId: actor.tenantId,
      reservationId: id,
      legacy: false,
      stay: null,
      blockers: blocked
        ? ["source_payer_required"]
        : canConfirm
          ? []
          : ["n3_billing_contract_unverified"],
      review: blocked
        ? null
        : {
            folioRevision: "1",
            planDigest: digest,
            totalCents: p.totalCents,
            currency: "MYR",
            canConfirm,
            legs: p.legs.map((l) => ({
              legId: l.legId,
              kind: l.kind,
              customerId: l.customerId,
              totalCents: l.snapshot.totalCents,
            })),
          },
    };
  }
  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  function button(text: string) {
    const b = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
    expect(b, `button ${text}`).toBeTruthy();
    return b!;
  }
  async function click(text: string) {
    await act(async () => button(text).click());
    await settle();
  }
  async function render(id = ids[0]) {
    await act(async () =>
      root.render(
        h(
          QueryClientProvider,
          { client: qc },
          h(SourceBillingCard, { key: id, reservationId: id }),
        ),
      ),
    );
    await settle();
  }
  beforeEach(async () => {
    const { Window } = await import(/* @vite-ignore */ domPackage!);
    win = new Window();
    for (const key of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLButtonElement",
      "Event",
      "MouseEvent",
      "IS_REACT_ACT_ENVIRONMENT",
    ])
      vi.stubGlobal(key, key === "IS_REACT_ACT_ENVIRONMENT" ? true : win[key as keyof typeof win]);
    const { createRoot } = await import("react-dom/client");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      role: "owner",
      tenant: { tenantId: actor.tenantId },
      user: { n3UserKey: actor.n3UserKey },
    });
    posts = [];
    gets = 0;
    canConfirm = true;
    digest = plan().digest;
    defer = false;
    blocked = false;
    stage = "review";
    matchFailure = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === "/api/session/me") return Response.json(qc.getQueryData(SESSION_QUERY_KEY));
        if (url === "/api/hotel/payment-accounts")
          return Response.json({
            accounts: [
              { id: "11111111-1111-4111-8111-111111111111", label: "CashNote", show: true },
            ],
          });
        const id = decodeURIComponent(url.split("/reservations/")[1]?.split("/")[0] ?? ids[0]);
        if (init.method === "POST") {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          const action = (posts.at(-1)!.body.action as { action?: string })?.action;
          if (action === "apply_deposits") stage = "payment";
          if (action === "receive_balance") stage = "received";
          if (action === "apply_balance") {
            if (matchFailure) return Response.json({ error: "n3_timeout" }, { status: 503 });
            stage = "settled";
          }
          if (defer)
            return new Promise<Response>((r) => {
              release = r;
            });
        } else gets++;
        return Response.json(data(id));
      }),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    await win.happyDOM.close();
    vi.unstubAllGlobals();
  });
  it("shows settlement steps and matches only the selected guest leg", async () => {
    stage = "deposit";
    await render();
    await click("Review final bills");
    expect(container.textContent).toContain("Knock Off / Settlement");
    expect(container.textContent).toContain("1. Post to N3");
    expect(container.textContent).toContain("2. Match Deposit");
    expect(button("Receive Payment").disabled).toBe(true);
    await click("Match Deposit");
    expect(posts).toHaveLength(1);
    const guest = plan().legs.find((l) => l.kind === "guest")!;
    expect(posts[0].body).toMatchObject({
      legId: guest.legId,
      planDigest: digest,
      expectedRevision: "2",
      action: { action: "apply_deposits", intentId: guest.legId, expectedRevision: "2" },
    });
    expect(posts[0].url).toMatch(/source-billing\/step$/);
    expect(button("Receive Payment").disabled).toBe(false);
  });
  async function enterPayment(amount = "40.00") {
    await click("Receive Payment");
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Payment method 1"]',
    )!;
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Amount 1"]')!;
    expect(select).toBeTruthy();
    await act(async () => {
      select.value = "11111111-1111-4111-8111-111111111111";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        amount,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const check = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    if (!check.disabled) await act(async () => check.click());
    await settle();
  }
  it("collects the exact guest balance and matches the saved receipt in two bounded requests", async () => {
    stage = "payment";
    await render();
    await click("Review final bills");
    await enterPayment();
    await click("Receive Payment");
    expect(posts.map((p) => (p.body.action as { action: string }).action)).toEqual([
      "receive_balance",
      "apply_balance",
    ]);
    expect((posts[0].body.action as { paymentLines: unknown }).paymentLines).toEqual([
      { accountId: "11111111-1111-4111-8111-111111111111", amountCents: 4000 },
    ]);
    expect(posts[1].body.expectedRevision).toBe("3");
    expect(container.textContent).toContain("No further payment required");
  });
  it("refuses overpayment before either receipt or matching dispatch", async () => {
    stage = "payment";
    await render();
    await click("Review final bills");
    await enterPayment("40.01");
    expect(button("Receive Payment").disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });
  it("retains saved payment after matching fails and offers recovery without recollection", async () => {
    stage = "payment";
    matchFailure = true;
    await render();
    await click("Review final bills");
    await enterPayment();
    await click("Receive Payment");
    expect(posts).toHaveLength(2);
    expect(container.textContent).toContain("Payment saved");
    expect(container.querySelector('input[aria-label="Amount 1"]')).toBeNull();
    expect(button("Match saved payment")).toBeTruthy();
    expect(button("Check N3 result")).toBeTruthy();
  });
  it("double payment clicks dispatch one receipt and stop before matching after booking navigation", async () => {
    stage = "payment";
    await render();
    await click("Review final bills");
    await enterPayment();
    defer = true;
    await act(async () => {
      button("Receive Payment").click();
      button("Receive Payment").click();
    });
    await settle();
    expect(posts).toHaveLength(1);
    await render(ids[1]);
    await act(async () => release(Response.json(data(ids[0]))));
    await settle();
    expect(posts).toHaveLength(1);
    expect((posts[0].body.action as { action: string }).action).toBe("receive_balance");
  });
  it("session change after receipt dispatch prevents automatic matching", async () => {
    stage = "payment";
    await render();
    await click("Review final bills");
    await enterPayment();
    defer = true;
    await click("Receive Payment");
    expect(posts).toHaveLength(1);
    await act(async () => {
      qc.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
    });
    await act(async () => release(Response.json(data())));
    await settle();
    expect(posts).toHaveLength(1);
    expect(container.querySelector('input[aria-label="Amount 1"]')).toBeNull();
  });
  it("recovers an initial preparation blocker through an explicit reload without remount", async () => {
    blocked = true;
    await render();
    await click("Review final bills");
    expect(container.textContent).toContain("Ask the Owner");
    expect(button("Reload bills").disabled).toBe(false);
    blocked = false;
    await click("Reload bills");
    expect(container.textContent).toContain("Source bill");
    expect(button("Confirm and post bills").disabled).toBe(false);
    expect(posts).toHaveLength(0);
  });
  it("refreshes only associated readers after source confirmation without a legacy settlement subscriber", async () => {
    const ownKeys = [
      ["folio", "tenant", ids[0]],
      ["checkout-preview", ids[0]],
      ["source-payer", `${actor.tenantId}:${actor.n3UserKey}:owner`, ids[0]],
      ["source-attribution", `${actor.tenantId}:${actor.n3UserKey}:owner`, ids[0]],
      ["financial-reporting", `${actor.tenantId}:staff:owner`, "month"],
    ];
    const foreignKeys = [
      ["folio", "tenant", ids[1]],
      ["checkout-preview", ids[1]],
      ["source-payer", `${actor.tenantId}:${actor.n3UserKey}:owner`, ids[1]],
      ["source-attribution", "99999999-9999-4999-8999-999999999999:staff:owner", ids[0]],
      ["financial-reporting", "99999999-9999-4999-8999-999999999999:staff:owner", "month"],
    ];
    for (const k of [...ownKeys, ...foreignKeys]) qc.setQueryData(k, { saved: true });
    await render();
    await click("Review final bills");
    await click("Confirm and post bills");
    expect(posts).toHaveLength(1);
    for (const k of ownKeys)
      expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
    for (const k of foreignKeys)
      expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(false);
  });
  it("mounts without posting and loads review only on explicit request", async () => {
    await render();
    expect(gets).toBe(0);
    expect(posts).toHaveLength(0);
    await click("Review final bills");
    expect(gets).toBe(1);
    expect(container.textContent).toContain("Source bill");
    expect(container.textContent).toContain("Guest bill");
    expect(posts).toHaveLength(0);
  });
  it("keeps posting disabled when contract acceptance is unavailable", async () => {
    canConfirm = false;
    await render();
    await click("Review final bills");
    expect(button("Confirm and post bills").disabled).toBe(true);
    expect(container.textContent).toContain("Refer Admin");
    expect(posts).toHaveLength(0);
  });
  it("double click submits one exact reviewed confirmation, with a stable request key", async () => {
    await render();
    await click("Review final bills");
    defer = true;
    await act(async () => {
      button("Confirm and post bills").click();
      button("Confirm and post bills").click();
    });
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toMatch(/source-billing\/confirm$/);
    expect(posts[0].body).toEqual({
      expectedFolioRevision: "1",
      planDigest: digest,
      clientRequestId: expect.any(String),
    });
    await act(async () => release(Response.json(data())));
    await settle();
  });
  it("background plan changes require an explicit fresh review", async () => {
    await render();
    await click("Review final bills");
    digest = "a".repeat(64);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["source-billing"] });
    });
    await settle();
    expect(button("Confirm and post bills").disabled).toBe(true);
    expect(container.textContent).toContain("changed");
    expect(posts).toHaveLength(0);
  });
  it("a late confirmation cannot populate a different reservation", async () => {
    await render();
    await click("Review final bills");
    defer = true;
    await click("Confirm and post bills");
    await render(ids[1]);
    await act(async () => release(Response.json(data(ids[0]))));
    await settle();
    expect(posts).toHaveLength(1);
    expect(container.textContent).not.toContain("Bills confirmed");
    expect(
      qc.getQueryData(["source-billing", `${actor.tenantId}:${actor.n3UserKey}:owner`, ids[1]]),
    ).toBeUndefined();
  });
});
