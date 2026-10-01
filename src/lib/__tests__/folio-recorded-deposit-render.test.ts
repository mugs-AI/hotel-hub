import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  recorded: {
    total: 50,
    currency: "MYR",
    count: 1,
    hasUnconfirmed: false,
    netFigure: 1064.55,
    items: [
      { n3DocCode: "OR2610/001", createdAt: "2026-10-01T00:00:00Z", amount: 50, currency: "MYR" },
    ],
  } as object | undefined,
  checkout: [] as unknown[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options, useParams: () => ({ id: "r" }) }),
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { settings: { folioBodyPt: 8.5, folioNotePt: 5 } } }),
}));
vi.mock("@/lib/session-client", () => ({
  useSessionMe: () => ({
    data: { authenticated: true, role: "owner", tenant: { companyName: "Hotel" } },
  }),
}));
vi.mock("@/lib/folio-bill-to-client", () => ({
  useFolioBillTo: () => ({
    data: { billTo: { name: "Guest", company: "", address: "", phone: "", email: "" } },
  }),
}));
vi.mock("@/lib/checkout-client", () => ({
  useCheckoutPreview: (id: unknown) => {
    state.checkout.push(id);
    return {};
  },
}));
vi.mock("@/lib/folio-client", () => ({
  folioErrorMessage: () => "error",
  useReservationFolio: () => ({
    data: {
      reservation: {
        bookingReference: "BK260920001",
        currency: "MYR",
        arrivalDate: "2026-09-20",
        departureDate: "2026-09-25",
      },
      propertyDate: "2026-10-01",
      readiness: {
        serviceChargeEnabled: false,
        serviceTaxEnabled: true,
        tourismTaxEnabled: false,
        localLevyEnabled: false,
      },
      catalogue: [],
      lines: [],
      derived: [],
      totals: {
        charges: 1032,
        serviceTax: 82.56,
        serviceCharge: 0,
        tourismTax: 0,
        localLevy: 0,
        rounding: -0.01,
        grandTotal: 1114.55,
      },
      recordedDeposits: state.recorded,
    },
  }),
}));
const { Route } = await import("@/routes/reservations.$id_.folio-print");
describe("prepared folio print with recorded deposits", () => {
  it("prints receipt details and the server net without starting N3 verification", () => {
    state.checkout = [];
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("OR2610/001");
    expect(html).toContain("50.00");
    expect(html).toContain("1064.55");
    expect(html).toContain("Net figure");
    expect(html).not.toContain("nothing here has been posted");
    expect(html).toContain("Not a tax invoice or receipt");
    expect(html).toContain("calc(5pt + 1pt)");
    expect(state.checkout).toEqual([undefined]);
  });
  it("does not print a made-up zero when recorded deposits are unavailable", () => {
    const saved = state.recorded;
    state.recorded = undefined;
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    state.recorded = saved;
    expect(html).toContain("Unable to load recorded deposits");
    expect(html).not.toContain("Net figure");
  });
});
