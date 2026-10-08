import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { captureFinancialJournals } from "../n3-financial-journals.server";

const nativeFetch = globalThis.fetch;
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
});

// Only substitute the external origin. Real HTTP/fetch still handle redirect
// behavior, while this boundary models workerd's documented Request limitation.
async function fixture(status = 200) {
  const paths: string[] = [];
  server = createServer((request, response) => {
    paths.push(request.url!);
    if (status !== 200) response.setHeader("Location", "/must-not-follow");
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end('{"code":"0000","data":[{"debit":100,"credit":0}]}');
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_not_listening");
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
    if (init.redirect === "error") throw new TypeError("workerd rejects redirect:error");
    const url = new URL(input);
    if (url.origin !== "https://openapi.account.qne.cloud") throw new Error("unexpected_origin");
    return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  });
  return paths;
}
const run = () =>
  captureFinancialJournals(
    {
      token: "synthetic-runtime-token",
      enabled: true,
      documents: [
        {
          resource: "cash_sales",
          id: "11111111-1111-4111-8111-111111111111",
          docCode: "CS-SYNTHETIC",
        },
      ],
    },
    (sample) => sample,
  );

it("captures a real HTTP response with the redirect modes accepted by workerd", async () => {
  const paths = await fixture();
  expect(await run()).toMatchObject({ status: "captured", captured: 1, performed: 1 });
  expect(paths).toEqual(["/api/CashSales/GLPosting?key=11111111-1111-4111-8111-111111111111"]);
});

it.each([301, 302, 303, 307, 308])(
  "rejects HTTP %i without following or retrying",
  async (status) => {
    const paths = await fixture(status);
    expect(await run()).toMatchObject({
      status: "unavailable",
      captured: 0,
      performed: 1,
      evidence: [{ httpStatus: status, responseSample: null, error: "journal_http_error" }],
    });
    expect(paths).toEqual(["/api/CashSales/GLPosting?key=11111111-1111-4111-8111-111111111111"]);
  },
);
