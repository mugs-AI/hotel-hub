import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useSignOut } from "../session-client";

afterEach(() => vi.unstubAllGlobals());
it("actual sign-out hook purges unmounted settlement readers and cancels late responses", async () => {
  const qc = new QueryClient();
  qc.setQueryData(["settlement", "A:user:owner", "saved"], { totalCents: 12345 });
  let finish!: (value: unknown) => void;
  let aborted = false;
  const pending = qc
    .fetchQuery({
      queryKey: ["settlement", "A:user:owner", "late"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    })
    .catch(() => undefined);
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  let logout!: ReturnType<typeof useSignOut>;
  function Probe() {
    logout = useSignOut();
    return createElement("div");
  }
  // No SettlementCard or settlement observer is mounted.
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  await logout.mutateAsync();
  finish({ totalCents: 99999 });
  await pending;
  expect(fetch).toHaveBeenCalledWith("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  expect(aborted).toBe(true);
  expect(qc.getQueryCache().findAll({ queryKey: ["settlement"] })).toHaveLength(0);
  qc.clear();
});
