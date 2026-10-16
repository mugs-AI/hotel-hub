import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChargeAttributionCard } from "../../components/ChargeAttributionCard";
import { SESSION_QUERY_KEY } from "../session-client";
import { actor } from "./fixtures/source-billing";
import { purgeSensitiveReceiptData } from "../receipt-controls-client";
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("mounted Owner charge attribution", () => {
  let win: Window & typeof globalThis & { happyDOM: { close(): Promise<void> } },
    root: import("react-dom/client").Root,
    container: HTMLElement,
    qc: QueryClient;
  let role: "owner" | "front_desk",
    frozen: boolean,
    digest: string,
    posts: { url: string; body: Record<string, unknown> }[],
    gets: number,
    defer: boolean,
    release: (r: Response) => void;
  const ids = [actor.reservationId, "88888888-8888-4888-8888-888888888888"];
  function data(id = ids[0]) {
    return {
      tenantId: actor.tenantId,
      reservationId: id,
      revision: "0",
      basisDigest: digest,
      frozen,
      stale: false,
      collectionMode: "source",
      currency: "MYR",
      guestCustomerId: 7,
      sourceCustomerId: 8,
      rows: [
        {
          lineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          kind: "room_night",
          description: "Room charge",
          totalCents: 30000,
          leg: "source_room",
        },
        {
          lineId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "local_levy",
          description: "Local levy",
          totalCents: 300,
          leg: null,
        },
      ],
      blockers: ["source_charge_attribution_required"],
    };
  }
  beforeEach(async () => {
    const { Window } = await import(/* @vite-ignore */ domPackage!);
    win = new Window();
    for (const key of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLSelectElement",
      "Event",
    ] as const)
      vi.stubGlobal(key, key === "window" ? win : win[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    role = "owner";
    frozen = false;
    digest = "a".repeat(64);
    posts = [];
    gets = 0;
    defer = false;
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      tenant: { tenantId: actor.tenantId, tenantCode: "TEST", companyName: "Hotel" },
      user: { n3UserKey: actor.n3UserKey },
      role,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input),
          id = url.includes(ids[1]) ? ids[1] : ids[0];
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push({ url, body });
          const response = Response.json({
            ...data(id),
            revision: "1",
            rows: data(id).rows.map((r) => ({
              ...r,
              leg: body.assignments.find((a: { lineId: string }) => a.lineId === r.lineId).leg,
            })),
            blockers: [],
          });
          return defer
            ? new Promise<Response>((r) => {
                release = r;
              })
            : response;
        }
        gets++;
        return Response.json(data(id));
      }),
    );
    container = win.document.createElement("div");
    win.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    vi.unstubAllGlobals();
    await win.happyDOM.close();
  });
  async function tick() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  async function render(id = ids[0]) {
    await act(async () =>
      root.render(
        h(QueryClientProvider, { client: qc }, h(ChargeAttributionCard, { reservationId: id })),
      ),
    );
    await tick();
  }
  function button(text: string) {
    return Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === text,
    )!;
  }
  async function click(text: string) {
    await act(async () => button(text).click());
    await tick();
  }
  async function select(value: string) {
    const el = container.querySelectorAll("select")[1];
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    await tick();
  }
  it("loads only on explicit review and saves exact complete membership without browser amounts", async () => {
    await render();
    expect(gets).toBe(0);
    await click("Review charges");
    expect(gets).toBe(1);
    expect(posts).toHaveLength(0);
    expect(button("Save allocation").disabled).toBe(true);
    await select("guest");
    await click("Save allocation");
    expect(posts[0].body).toEqual({
      expectedRevision: "0",
      basisDigest: digest,
      assignments: [
        { lineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", leg: "source_room" },
        { lineId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", leg: "guest" },
      ],
    });
  });
  it("Front Desk and frozen stays are read-only", async () => {
    role = "front_desk";
    qc.setQueryData(SESSION_QUERY_KEY, (old: Record<string, unknown>) => ({ ...old, role }));
    frozen = true;
    await render();
    await click("Review charges");
    expect(Array.from(container.querySelectorAll("select")).every((s) => s.disabled)).toBe(true);
    expect(button("Save allocation")).toBeUndefined();
  });
  it("background basis changes require explicit refreshed review", async () => {
    await render();
    await click("Review charges");
    await select("guest");
    digest = "b".repeat(64);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["source-attribution"] });
    });
    await tick();
    expect(button("Save allocation").disabled).toBe(true);
    expect(container.textContent).toContain("changed");
    expect(posts).toHaveLength(0);
  });
  it("a late save cannot replace another booking's allocation", async () => {
    defer = true;
    await render();
    await click("Review charges");
    await select("guest");
    await click("Save allocation");
    await render(ids[1]);
    await act(async () => release(Response.json({ ...data(), revision: "1" })));
    await tick();
    expect(
      qc
        .getQueryCache()
        .findAll({ queryKey: ["source-attribution"] })
        .filter((q) => q.queryKey[2] === ids[1])
        .every(
          (q) =>
            q.state.data === undefined ||
            (q.state.data as { reservationId: string }).reservationId === ids[1],
        ),
    ).toBe(true);
  });
  it("central identity purge clears allocation even when this card is closed", async () => {
    qc.setQueryData(["source-attribution", "previous", ids[0]], data());
    purgeSensitiveReceiptData(qc, null);
    await tick();
    expect(qc.getQueryCache().findAll({ queryKey: ["source-attribution"] })).toHaveLength(0);
  });
});
