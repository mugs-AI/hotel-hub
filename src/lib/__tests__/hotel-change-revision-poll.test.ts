import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ options: null as unknown }));
vi.mock("react", () => ({
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: () => [true, () => {}],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: (options: unknown) => {
    state.options = options;
    return { isError: false };
  },
}));
vi.mock("../receipt-controls-client", () => ({
  useReceiptIdentity: () => "t:u:owner",
  RECEIPT_EFFECT_QUERY_PREFIXES: [],
  purgeSensitiveReceiptData: () => {},
}));
import { useHotelChangeRevision } from "../hotel-change-revision-client";
it("continues two-second polling after transient errors but blocks authentication failures", () => {
  useHotelChangeRevision();
  const options = state.options as { refetchInterval: (q: unknown) => number | false };
  const q = (status: number) => ({
    state: { status: "error", error: { status }, data: { available: true } },
  });
  expect(options.refetchInterval(q(503))).toBe(2000);
  expect(options.refetchInterval(q(502))).toBe(2000);
  expect(options.refetchInterval(q(401))).toBe(false);
  expect(options.refetchInterval(q(403))).toBe(false);
});
