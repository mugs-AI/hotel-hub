import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { captureSettlementMasters } from "../n3-settlement-master-diagnostics.server";

const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3UserKey: "fixture-owner",
  n3Token: "synthetic-master-runtime-token",
  role: "owner" as const,
};
const input = { masters: [{ kind: "stock" as const, id: 101 }] };
const nativeFetch = globalThis.fetch;
let server: Server | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
});

// Real loopback HTTP/native fetch; only the external origin and workerd's
// Request-mode restriction are substituted. No live N3 or credentials.
async function fixture(status = 200) {
  const requests: Array<{ path: string; method: string; authorization: string }> = [];
  server = createServer((request, response) => {
    requests.push({
      path: request.url!,
      method: request.method!,
      authorization: request.headers.authorization!,
    });
    if (status !== 200) response.setHeader("Location", "/must-not-follow");
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end('{"code":"0000","data":{"id":101,"isActive":true}}');
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture_not_listening");
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (init.redirect === "error") throw TypeError("workerd rejects redirect:error");
    const parsed = new URL(url);
    if (parsed.origin !== "https://openapi.account.qne.cloud") throw Error("unexpected_origin");
    return nativeFetch(`http://127.0.0.1:${address.port}${parsed.pathname}`, init);
  });
  return requests;
}

it("captures a real HTTP master response using a workerd-supported redirect mode", async () => {
  const requests = await fixture();
  const report = await captureSettlementMasters(actor, input);
  expect(report).toMatchObject({
    status: "captured",
    contractAccepted: false,
    evidence: [{ httpStatus: 200, status: "captured", sample: { data: { id: 101 } } }],
  });
  expect(requests).toEqual([
    { path: "/api/Stocks/101", method: "GET", authorization: `Bearer ${actor.n3Token}` },
  ]);
});

it.each([301, 302, 303, 307, 308])(
  "refuses redirect %i without following or retrying",
  async (status) => {
    const requests = await fixture(status);
    const report = await captureSettlementMasters(actor, input);
    expect(report).toMatchObject({
      status: "partial",
      evidence: [
        {
          httpStatus: status,
          status: "unavailable",
          failureReason: "redirect_refused",
          sample: null,
        },
      ],
    });
    expect(requests.map((r) => r.path)).toEqual(["/api/Stocks/101"]);
  },
);

it("exports only a safe reason for immediate transport failures", async () => {
  const report = await captureSettlementMasters(actor, input, {
    fetcher: async () => {
      throw Error(`private error ${actor.n3Token} ${actor.tenantId}`);
    },
  });
  expect(report.evidence[0]).toMatchObject({
    attempted: true,
    failureReason: "transport_error",
    httpStatus: null,
    sample: null,
    durationMs: expect.any(Number),
  });
  expect(JSON.stringify(report)).not.toContain(actor.n3Token);
  expect(JSON.stringify(report)).not.toContain(actor.tenantId);
  expect(JSON.stringify(report)).not.toContain("private error");
});

it("separates skipped batch deadlines from attempted request timeouts", async () => {
  vi.useFakeTimers();
  const promise = captureSettlementMasters(
    actor,
    {
      masters: Array.from({ length: 8 }, (_, i) => ({ kind: "stock", id: i + 1 })),
    },
    { fetcher: () => new Promise(() => {}) },
  );
  await vi.advanceTimersByTimeAsync(30_000);
  const report = await promise;
  expect(report.evidence.slice(0, 6)).toEqual(
    Array.from({ length: 6 }, (_, i) =>
      expect.objectContaining({
        id: i + 1,
        attempted: true,
        failureReason: "request_timeout",
        durationMs: 5000,
      }),
    ),
  );
  expect(report.evidence.slice(6)).toEqual(
    Array.from({ length: 2 }, (_, i) =>
      expect.objectContaining({
        id: i + 7,
        attempted: false,
        failureReason: "batch_deadline",
        durationMs: 0,
      }),
    ),
  );
});

it("does not mutate a returned timeout report when a detached response arrives late", async () => {
  vi.useFakeTimers();
  let complete!: (response: Response) => void;
  const promise = captureSettlementMasters(actor, input, {
    fetcher: () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  });
  await vi.advanceTimersByTimeAsync(5000);
  const report = await promise;
  const saved = JSON.stringify(report);
  complete(Response.json({ code: "0000", data: { id: 101 } }));
  await vi.advanceTimersByTimeAsync(1);
  expect(JSON.stringify(report)).toBe(saved);
  expect(report.evidence[0]).toMatchObject({ failureReason: "request_timeout", httpStatus: null });
});

it.each([
  { response: () => new Response(null, { status: 403 }), reason: "http_error", http: 403 },
  { response: () => new Response(null, { status: 200 }), reason: "body_unavailable", http: 200 },
  { response: () => new Response("not JSON"), reason: "invalid_response", http: 200 },
  {
    response: () => Response.json({ code: "FAILED", data: { id: 101 } }),
    reason: "invalid_response",
    http: 200,
  },
  {
    response: () => new Response("large", { headers: { "content-length": "1000001" } }),
    reason: "response_limit",
    http: 200,
  },
])("classifies $reason without exporting an upstream body", async ({ response, reason, http }) => {
  const report = await captureSettlementMasters(actor, input, { fetcher: async () => response() });
  expect(report.evidence[0]).toMatchObject({
    attempted: true,
    httpStatus: http,
    failureReason: reason,
    sample: null,
    responseHash: null,
  });
});

it("records response-budget skips without attempting another request", async () => {
  const report = await captureSettlementMasters(
    actor,
    {
      masters: [
        { kind: "stock", id: 101 },
        { kind: "stock", id: 102 },
      ],
    },
    {
      fetcher: async () => new Response("too large", { headers: { "content-length": "1000001" } }),
    },
  );
  expect(report.evidence[1]).toMatchObject({
    attempted: false,
    failureReason: "response_limit",
    httpStatus: null,
    durationMs: 0,
  });
});
