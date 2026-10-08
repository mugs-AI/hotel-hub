import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFinancialJournals, type JournalDocument } from "../n3-financial-journals.server";
import { sanitize, assertNoInternalOrSecretFields } from "../n3-financial.server";
import { parseN3LosslessJson } from "../n3-lossless-json.server";

const id = "11111111-1111-4111-8111-111111111111";
const document: JournalDocument = { resource: "cash_sales", id, docCode: "CS-SYNTHETIC" };
const run = (documents = [document], extra = {}) =>
  captureFinancialJournals(
    {
      token: "synthetic-session-token",
      enabled: true,
      documents,
      ...extra,
    },
    sanitize,
  );
const ok = () =>
  new Response(
    JSON.stringify({
      code: "0000",
      data: [
        {
          accountId: "22222222-2222-4222-8222-222222222222",
          debit: 100,
          credit: 0,
          token: "must-not-export",
          email: "synthetic@example.test",
        },
      ],
    }),
    { status: 200 },
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Opt-in fixed-path journal capture", () => {
  it("makes no journal request unless explicitly enabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await run([document], { enabled: false })).toMatchObject({
      status: "not_requested",
      performed: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads each of the three documented journal endpoints by GET using the server token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok());
    vi.stubGlobal("fetch", fetch);
    const docs = ["ar_receipts", "cash_sales", "customer_refunds"].map(
      (resource) => ({ ...document, resource }) as JournalDocument,
    );
    const result = await run(docs);
    expect(result).toMatchObject({ status: "captured", requested: 3, performed: 3, captured: 3 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `https://openapi.account.qne.cloud/api/ARReceipts/GLPosting?key=${id}`,
      `https://openapi.account.qne.cloud/api/CashSales/GLPosting?key=${id}`,
      `https://openapi.account.qne.cloud/api/CustomerRefunds/GLPosting?key=${id}`,
    ]);
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({
        method: "GET",
        headers: { authorization: "Bearer synthetic-session-token" },
        redirect: "manual",
      });
    assertNoInternalOrSecretFields(result);
    expect(JSON.stringify(result)).not.toContain("must-not-export");
    expect(JSON.stringify(result)).not.toContain("synthetic@example.test");
    expect(JSON.stringify(result)).not.toContain("synthetic-session-token");
  });
  it("deduplicates a document without confusing receipt and bill resource identities", async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetch);
    const result = await run([document, document, { ...document, resource: "ar_receipts" }]);
    expect(result).toMatchObject({ requested: 2, performed: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["../../bad", "https://example.test", "00000000-0000-0000-0000-000000000000"])(
    "refuses an unsafe document locator %s",
    async (bad) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(await run([{ ...document, id: bad }])).toMatchObject({
        status: "unavailable",
        performed: 0,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("cannot use a caller-provided resource as a path", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await run([{ ...document, resource: "constructor" } as unknown as JournalDocument]),
    ).toMatchObject({ status: "unavailable", performed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports the cap as partial rather than presenting the first 12 of 13 as complete", async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetch);
    const docs = Array.from({ length: 13 }, (_, i) => ({
      ...document,
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    }));
    expect(await run(docs)).toMatchObject({
      status: "partial",
      requested: 13,
      performed: 12,
      captured: 12,
      truncated: true,
    });
    expect(fetch).toHaveBeenCalledTimes(12);
  });
  it("does not turn an incomplete list/detail source into complete journal coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    expect(await run([document], { sourceIncomplete: true })).toMatchObject({
      status: "partial",
      sourceIncomplete: true,
    });
  });
  it.each([
    new Response('{"code":"0000","data":[]}', { status: 200 }),
    new Response('{"code":"9999","data":[{}]}', { status: 200 }),
    new Response('{"code":"0000","data":[{}],"code":"9999"}', { status: 200 }),
    new Response("not json", { status: 200 }),
    new Response("no", { status: 500 }),
  ])("does not confirm empty, malformed, contradictory or failed responses", async (response) => {
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    expect(await run()).toMatchObject({ status: "unavailable", captured: 0, performed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves oversized integer journal IDs as exact strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"code":"0000","data":[{"id":9223372036854775807,"debit":100,"credit":0}]}',
          ),
      ),
    );
    expect(JSON.stringify(await run())).toContain('"id":"9223372036854775807"');
  });
  it("removes the session token from document metadata as well as journal strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    expect(
      JSON.stringify(await run([{ ...document, docCode: "synthetic-session-token" }])),
    ).not.toContain("synthetic-session-token");
  });
  it("does not export a secret carried in an invalid envelope code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "synthetic-session-token",
              data: [{}],
            }),
          ),
      ),
    );
    const result = await run();
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("synthetic-session-token");
  });
  it("removes tenant IDs through nested arrays and redacts unknown journal text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "0000",
              tenant: [[{ id: "synthetic-private-tenant" }]],
              data: [
                {
                  id: "9223372036854775807",
                  accountId: id,
                  debit: "100.01",
                  credit: 0,
                  description: "Alice Smith alice@example.test",
                  customText: "private personal notes",
                  customer: { id: 7, name: "Alice Smith" },
                  "synthetic-session-token": "private-key-value",
                },
              ],
            }),
          ),
      ),
    );
    const result = await run();
    const exported = JSON.stringify(result);
    for (const secret of [
      "synthetic-private-tenant",
      "Alice Smith",
      "alice@example.test",
      "private personal notes",
      "synthetic-session-token",
      "private-key-value",
    ])
      expect(exported).not.toContain(secret);
    expect(exported).toContain("9223372036854775807");
    expect(exported).toContain("100.01");
    assertNoInternalOrSecretFields(result);
  });
  it("marks a shortened sample as partial coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "0000",
              data: Array.from({ length: 201 }, () => ({ debit: 1, credit: 0 })),
            }),
          ),
      ),
    );
    expect(await run()).toMatchObject({
      status: "partial",
      truncated: true,
      evidence: [{ sampleTruncated: true }],
    });
  });
  it("retains observed 401 even when its response body cannot be read", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private error synthetic-session-token"));
        },
      }),
      { status: 401 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const result = await run();
    expect(result).toMatchObject({ status: "unauthorized", captured: 0 });
    expect(JSON.stringify(result)).not.toContain("private error");
  });
  it("rejects oversized bodies rather than exporting a clipped journal as complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(1_000_001))),
    );
    expect(await run()).toMatchObject({ status: "unavailable", captured: 0 });
  });
  it("bounds active reads to three and stops scheduling after observed 401", async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    vi.stubGlobal("fetch", fetch);
    const docs = Array.from({ length: 6 }, (_, i) => ({
      ...document,
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    }));
    const pending = run(docs);
    expect(fetch).toHaveBeenCalledTimes(3);
    resolvers[0](new Response(null, { status: 401 }));
    await Promise.resolve();
    await Promise.resolve();
    resolvers[1](ok());
    resolvers[2](ok());
    expect(await pending).toMatchObject({ status: "unauthorized", performed: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("aborts a slow response after 10 seconds without retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = run();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ status: "unavailable", performed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Shared lossless JSON evidence parsing", () => {
  it("preserves actual int64 tokens without rounding", () => {
    expect(parseN3LosslessJson('{"id":9223372036854775807,"amount":60.01}')).toEqual({
      id: "9223372036854775807",
      amount: 60.01,
    });
  });
  it.each(['{"id":1,"id":2}', '{"id":9.223372036854776e18}', '{"id":1} trailing'])(
    "rejects ambiguous JSON %s",
    (text) => expect(() => parseN3LosslessJson(text)).toThrow(),
  );
});
