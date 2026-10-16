import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReservationPayerCard } from "../../components/ReservationPayerCard";
import { SourceBillingPolicyPanel } from "../../components/SourceBillingPolicyPanel";
import { SESSION_QUERY_KEY } from "../session-client";
import { purgeSensitiveReceiptData } from "../receipt-controls-client";
import type { SourceBillingPolicy } from "../source-billing";
import { actor, plan } from "./fixtures/source-billing";
const domPackage = process.env.HH_UI_DOM_PACKAGE;
const policy = plan().payer.policy,
  ids = [actor.reservationId, "88888888-8888-4888-8888-888888888888"];
describe.skipIf(!domPackage)("mounted source policy and saved payer lifecycle", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow },
    window: DomWindow,
    createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>,
    container: HTMLElement,
    qc: QueryClient,
    posts: Array<{ url: string; body: Record<string, unknown> }>;
  let role: "owner" | "front_desk",
    frozen: boolean,
    readFails: boolean,
    release: ((r: Response) => void) | null,
    defer: boolean;
  let currentPolicy: SourceBillingPolicy,
    existingMode: "guest" | "source" | null,
    configurationBlocked: boolean;
  function payer(
    id: string,
    mode: "guest" | "source" = existingMode ?? "source",
    revision = existingMode ? "1" : "0",
  ) {
    return {
      tenantId: actor.tenantId,
      reservationId: id,
      sourceId: policy.sourceId,
      revision,
      updatedAt: "2026-10-15T02:00:00Z",
      frozen,
      payer:
        revision === "0"
          ? null
          : {
              policy,
              collectionMode: mode,
              confirmedBy: actor.n3UserKey,
              confirmedAt: "2026-10-15T02:01:00Z",
            },
      policy: currentPolicy,
      blockers: [],
    };
  }
  function setSession(who = actor.n3UserKey) {
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      tenant: { tenantId: actor.tenantId, tenantCode: "TEST", companyName: "Hotel" },
      user: { n3UserKey: who },
      role,
    });
  }
  beforeAll(async () => {
    ({ Window: WindowCtor } = await import(/* @vite-ignore */ domPackage!));
  });
  beforeEach(async () => {
    window = new WindowCtor();
    for (const k of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLSelectElement",
      "Event",
      "MouseEvent",
    ] as const)
      vi.stubGlobal(k, k === "window" ? window : window[k]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    ({ createRoot } = await import("react-dom/client"));
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
    posts = [];
    role = "owner";
    frozen = false;
    readFails = false;
    release = null;
    defer = false;
    currentPolicy = structuredClone(policy);
    existingMode = null;
    configurationBlocked = false;
    setSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push({ url, body });
          const response = url.includes("billing-policy")
            ? {
                tenantId: actor.tenantId,
                sourceId: policy.sourceId,
                policy: { ...body.policy, version: "2" },
              }
            : payer(url.includes(ids[1]) ? ids[1] : ids[0], body.collectionMode, "1");
          if (defer)
            return new Promise<Response>((resolve) => {
              release = resolve;
            });
          return Response.json(response);
        }
        if (readFails) return Response.json({ error: "unauthenticated" }, { status: 401 });
        if (url.includes("billing-policy"))
          return Response.json({
            tenantId: actor.tenantId,
            sourceId: policy.sourceId,
            policy: currentPolicy,
            blockers: configurationBlocked ? ["master_customer_inactive"] : [],
          });
        if (url.includes("/payer"))
          return Response.json(payer(url.includes(ids[1]) ? ids[1] : ids[0]));
        if (url.includes("/customers/all"))
          return Response.json({
            items: [
              { id: "7", code: "GUEST", name: "Guest" },
              { id: "8", code: "SOURCE", name: "Booking source" },
            ],
            total: 2,
          });
        throw Error("unexpected URL " + url);
      }),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    vi.unstubAllGlobals();
    await window.happyDOM.close();
  });
  async function tick() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 80; i++) {
      if (check()) return;
      await tick();
    }
    throw Error("UI did not reach expected state: " + container.textContent);
  }
  async function render(component: ReturnType<typeof h>) {
    await act(async () => root.render(h(QueryClientProvider, { client: qc }, component)));
    await tick();
  }
  function button(label: string) {
    const b = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!b) throw Error("missing button " + label);
    return b;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
    await tick();
  }
  async function select(label: string, value: string) {
    const el = container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    if (!el) throw Error("missing select " + label);
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await tick();
  }
  it("opening a reservation reads without saving; Owner explicitly saves its exact revision", async () => {
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    expect(posts).toHaveLength(0);
    await select("Collection mode", "guest");
    await click("Save payer");
    expect(posts).toEqual([
      {
        url: `/api/hotel/reservations/${ids[0]}/payer`,
        body: {
          collectionMode: "guest",
          expectedRevision: "0",
          expectedSourceId: policy.sourceId,
          expectedPolicyVersion: policy.version,
          expectedReservationUpdatedAt: "2026-10-15T02:00:00Z",
        },
      },
    ]);
    await until(() => container.textContent?.includes("Guest pays") === true);
  });
  it("an unknown session asks for sign-in instead of showing a permanent loading state", async () => {
    qc.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    expect(container.textContent).toContain("Sign in to view billing collection");
    expect(container.querySelector('[aria-label="Collection mode"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
  it("Front Desk can read but cannot change the payer", async () => {
    role = "front_desk";
    setSession();
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => container.textContent?.includes("Only the Owner") === true);
    expect(container.querySelector('[aria-label="Collection mode"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
  it("a frozen bill exposes no payer save action", async () => {
    frozen = true;
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => container.textContent?.includes("Billing is frozen") === true);
    expect(container.querySelector('[aria-label="Collection mode"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
  it("a late response for booking A cannot replace booking B or dispatch another save", async () => {
    defer = true;
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    await select("Collection mode", "guest");
    await click("Save payer");
    await render(h(ReservationPayerCard, { reservationId: ids[1] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    await act(async () => {
      release!(Response.json(payer(ids[0], "guest", "1")));
    });
    await tick();
    expect(
      (container.querySelector('[aria-label="Collection mode"]') as HTMLSelectElement).value,
    ).toBe("source");
    expect(posts).toHaveLength(1);
  });
  it("an expired session clears cached payer and disables saving", async () => {
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    readFails = true;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["source-payer"] });
    });
    await tick();
    expect(container.querySelector('[aria-label="Collection mode"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
  it("Settings reads only the selected source and saves one versioned policy", async () => {
    await render(
      h(SourceBillingPolicyPanel, {
        sources: [{ id: policy.sourceId, displayName: "Agoda", isActive: true }],
      }),
    );
    expect(posts).toHaveLength(0);
    await select("Billing source", policy.sourceId);
    await until(() => !!container.querySelector('[aria-label="Guest document title"]'));
    const title = container.querySelector(
      '[aria-label="Guest document title"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(title, "Guest voucher");
      title.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click("Save billing policy");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      expectedVersion: "1",
      policy: { sourceId: policy.sourceId, guestDocumentTitle: "Guest voucher" },
    });
  });
  it("an identity switch discards pending selection and ignores late save data", async () => {
    defer = true;
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    await select("Collection mode", "guest");
    await click("Save payer");
    await act(async () => setSession("another-owner"));
    await tick();
    await act(async () => release!(Response.json(payer(ids[0], "guest", "1"))));
    await tick();
    expect(
      qc.getQueryData(["source-payer", `${actor.tenantId}:${actor.n3UserKey}:owner`, ids[0]]),
    ).toBeUndefined();
    expect(posts).toHaveLength(1);
  });
  it("Enter in customer search cancels implicit policy submission", async () => {
    await render(
      h(SourceBillingPolicyPanel, {
        sources: [{ id: policy.sourceId, displayName: "Agoda", isActive: true }],
      }),
    );
    await select("Billing source", policy.sourceId);
    await until(() => !!container.querySelector('[aria-label="Guest document title"]'));
    await click("Choose guest customer");
    await until(() => !!container.querySelector('[aria-label="Search customers"]'));
    const event = new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      container.querySelector('[aria-label="Search customers"]')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(posts).toHaveLength(0);
  });
  it("paging and choosing customers never submits the surrounding policy form", async () => {
    await render(
      h(SourceBillingPolicyPanel, {
        sources: [{ id: policy.sourceId, displayName: "Agoda", isActive: true }],
      }),
    );
    await select("Billing source", policy.sourceId);
    await until(() => !!container.querySelector('[aria-label="Guest document title"]'));
    await click("Choose guest customer");
    await until(() =>
      [...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "1"),
    );
    await click("1");
    expect(posts).toHaveLength(0);
    await click("Select");
    expect(posts).toHaveLength(0);
  });
  it("shows prospective room and extras accounts even before the first payer save", async () => {
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    expect(container.textContent).toContain("Room bill: Source N3 account #8");
    expect(container.textContent).toContain("Guest extras: Guest N3 account #7");
  });
  it("separately shows saved and prospective accounts when current source policy changed", async () => {
    existingMode = "source";
    currentPolicy = { ...currentPolicy, version: "2", guestCustomerId: 9, sourceCustomerId: 10 };
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    expect(container.textContent).toContain("Source N3 account #8");
    expect(container.textContent).toContain("Room bill: Source N3 account #10");
    expect(container.textContent).toContain("Guest extras: Guest N3 account #9");
  });
  it("requires an explicit allowed choice when the saved mode was removed", async () => {
    existingMode = "source";
    currentPolicy = {
      ...currentPolicy,
      version: "2",
      allowedCollectionModes: ["guest"],
      defaultCollectionMode: "guest",
      sourceCustomerId: null,
    };
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    expect(
      (container.querySelector('[aria-label="Collection mode"]') as HTMLSelectElement).value,
    ).toBe("");
    expect(button("Save payer").disabled).toBe(true);
    await select("Collection mode", "guest");
    expect(button("Save payer").disabled).toBe(false);
    await click("Save payer");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ collectionMode: "guest", expectedPolicyVersion: "2" });
  });
  it("keeps Owner repair controls available with a visible verification warning", async () => {
    configurationBlocked = true;
    await render(
      h(SourceBillingPolicyPanel, {
        sources: [{ id: policy.sourceId, displayName: "Agoda", isActive: true }],
      }),
    );
    await select("Billing source", policy.sourceId);
    await until(() => !!container.querySelector('[aria-label="Guest document title"]'));
    expect(container.textContent).toContain("Current customer verification needs attention");
    expect(button("Choose guest customer").disabled).toBe(false);
    expect(posts).toHaveLength(0);
  });
  it("a background policy change requires explicit refreshed review before saving", async () => {
    await render(h(ReservationPayerCard, { reservationId: ids[0] }));
    await until(() => !!container.querySelector('[aria-label="Collection mode"]'));
    currentPolicy = { ...currentPolicy, version: "2", sourceCustomerId: 10, guestCustomerId: 9 };
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["source-payer"] });
    });
    await tick();
    expect(button("Save payer").disabled).toBe(true);
    await click("Refresh payer");
    expect(button("Save payer").disabled).toBe(false);
    await click("Save payer");
    expect(posts[0].body).toMatchObject({
      expectedPolicyVersion: "2",
      expectedSourceId: policy.sourceId,
    });
  });
  it("central auth cleanup removes payer and policy caches even when their screens are closed", () => {
    qc.setQueryData(["source-payer", "old", ids[0]], { private: "old" });
    qc.setQueryData(["source-policy", "old", policy.sourceId], { private: "old" });
    purgeSensitiveReceiptData(qc, null);
    expect(qc.getQueryData(["source-payer", "old", ids[0]])).toBeUndefined();
    expect(qc.getQueryData(["source-policy", "old", policy.sourceId])).toBeUndefined();
  });
});
