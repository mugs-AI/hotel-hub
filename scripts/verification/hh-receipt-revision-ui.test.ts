// Mounted React/QueryClient with fixture fetch only; no backend or N3 requests.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const req = createRequire(
  resolve(".superpowers/sdd/2026-10-03-automatic-receipt-correction/dom-tools/package.json"),
);
const { JSDOM } = req("jsdom");
const dom = new JSDOM("<html><body></body></html>", { url: "https://fixture.test" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { useHotelChangeRevision } = await import("../../src/lib/hotel-change-revision-client");
const { SESSION_QUERY_KEY } = await import("../../src/lib/session-client");
let revision: string, amount: number, visible: boolean, reads: number, denied: boolean;
let readStatus: number;
let roots: Array<ReturnType<typeof createRoot>>, clients: QueryClient[];
const session = (role = "owner") => ({
  authenticated: true,
  tenant: { tenantId: "t" },
  user: { n3UserKey: role },
  role,
});
const pause = () => new Promise((done) => setTimeout(done, 20));
function Harness({ identity }: { identity: string }) {
  useHotelChangeRevision();
  const q = useQuery({
    queryKey: ["folio", "r"],
    queryFn: async () => (await fetch("/fixture/folio")).json(),
  });
  return createElement("span", null, q.data?.amount ?? "Loading");
}
async function mount(role = "owner") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(qc);
  qc.setQueryData(SESSION_QUERY_KEY, session(role));
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Harness, { identity: `t:${role}:${role}` }),
      ),
    );
    await pause();
  });
  await act(async () => {
    await pause();
  });
  return { qc, div };
}
beforeEach(() => {
  revision = "1";
  amount = 50;
  visible = true;
  reads = 0;
  denied = false;
  readStatus = 200;
  roots = [];
  clients = [];
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/hotel/change-revision") {
        reads++;
        return Response.json({ available: true, revision }, { status: denied ? 401 : readStatus });
      }
      if (url === "/fixture/folio") return Response.json({ amount });
      if (url === "/api/session/me")
        return Response.json(denied ? { authenticated: false } : session());
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  for (const qc of clients) qc.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("hidden mounted sessions send no revision request until visible", async () => {
  visible = false;
  await mount();
  expect(reads).toBe(0);
  visible = true;
  await act(async () => {
    document.dispatchEvent(new dom.window.Event("visibilitychange"));
    await pause();
  });
  expect(reads).toBe(1);
});
it("two mounted sessions replace RM50 with verified RM65 once after revision changes", async () => {
  const owner = await mount(),
    staff = await mount("front_desk");
  expect(owner.div.textContent).toBe("50");
  expect(staff.div.textContent).toBe("50");
  revision = "2";
  amount = 65;
  await act(async () => {
    await Promise.all(
      clients.map((qc) => qc.refetchQueries({ queryKey: ["hotel-change-revision"] })),
    );
    await pause();
  });
  await act(async () => {
    await pause();
  });
  expect(owner.div.textContent).toBe("65");
  expect(staff.div.textContent).toBe("65");
  expect(owner.div.textContent).not.toBe("115");
});
it("Housekeeper never requests financial revision metadata", async () => {
  await mount("housekeeper");
  expect(reads).toBe(0);
});
it("failed revision authentication purges sensitive query and mutation results", async () => {
  const { qc } = await mount();
  qc.setQueryData(["hotel-change-policy", "t:owner:owner"], { private: true });
  qc.getMutationCache().build(qc, { mutationKey: ["folio-bill-to", "t:owner:owner", "save"] });
  denied = true;
  await act(async () => {
    await qc.refetchQueries({ queryKey: ["hotel-change-revision"] });
    await pause();
  });
  expect(qc.getQueryData(["hotel-change-policy", "t:owner:owner"])).toBeUndefined();
  expect(qc.getMutationCache().getAll()).toHaveLength(0);
});

it("recovered revision reads refresh mounted RM50 to RM65 after a temporary outage", async () => {
  const { qc, div } = await mount();
  expect(div.textContent).toBe("50");
  readStatus = 503;
  await act(async () => {
    await qc.refetchQueries({ queryKey: ["hotel-change-revision"] });
    await pause();
  });
  revision = "2";
  amount = 65;
  readStatus = 200;
  await act(async () => {
    await qc.refetchQueries({ queryKey: ["hotel-change-revision"] });
    await pause();
  });
  await act(async () => {
    await pause();
  });
  expect(div.textContent).toBe("65");
});
