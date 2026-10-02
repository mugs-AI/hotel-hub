import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepositDTO } from "@/lib/deposits-client";
import type { ReservationDetailGuestDTO } from "@/lib/reservations-client";

const view = vi.hoisted(() => ({
  status: "confirmed",
  error: null as { code: string } | null,
  review: false,
  deposits: [] as DepositDTO[],
  guests: [] as ReservationDetailGuestDTO[],
  total: 0,
  preview: undefined as
    | undefined
    | {
        bookingReference: string;
        customerLabel: string;
        currency: string;
        amount: number;
        warning: string;
        paymentLines: Array<{ accountLabel: string; amount: number }>;
      },
}));
vi.mock("@tanstack/react-router", async (original) => {
  const actual = await original<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      options,
      useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
      useSearch: () => ({}),
    }),
    Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
    useNavigate: () => () => {},
  };
});
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/session-client", () => ({
  useSessionMe: () => ({
    data: { authenticated: true, role: "owner", tenant: { tenantId: "fixture-tenant" } },
  }),
}));
vi.mock("@/lib/reservations-client", async (original) => ({
  ...(await original<typeof import("@/lib/reservations-client")>()),
  useBookingSources: () => ({ data: { sources: [] } }),
  useReservationDetail: () => ({
    data: {
      reservation: {
        id: "11111111-1111-4111-8111-111111111111",
        bookingReference: "BK260920001",
        bookingSource: "walk_in",
        status: view.status,
        arrivalDate: "2026-09-20",
        departureDate: "2026-09-25",
        currency: "MYR",
        createdAt: "2026-09-20T08:40:00Z",
        updatedAt: "2026-09-24T14:29:00Z",
        rooms: [],
        guests: view.guests,
      },
      editCapabilities: { canAssignGuestRooms: false },
      checkInAction: null,
    },
  }),
}));
vi.mock("@/lib/workspace-context", async (original) => {
  const actual = await original<typeof import("@/lib/workspace-context")>();
  return {
    ...actual,
    useReservationTabLabel: () => {},
    useWorkspaceDraft: (name: string, initial: unknown) =>
      name === "deposit-attempt" && view.review
        ? [
            {
              phase: "review",
              amount: 50,
              paymentLines: [{ accountId: "bank", amount: 50 }],
              clientRequestId: "attempt",
            },
            () => {},
          ]
        : actual.useWorkspaceDraft(name, initial),
  };
});
vi.mock("@/lib/deposits-client", async (original) => ({
  ...(await original<typeof import("@/lib/deposits-client")>()),
  useReservationDeposits: () => ({
    data: {
      deposits: view.deposits,
      summary: {
        total: view.total,
        currency: "MYR",
        count: view.deposits.filter((d) => d.status === "posted").length,
      },
      capability: { canCreate: true },
    },
  }),
  usePaymentAccounts: () => ({
    isSuccess: true,
    data: { accounts: [{ id: "bank", label: "DuitNow", code: "700-0310" }] },
  }),
  useCreateDeposit: () => ({ isPending: false }),
  useReconcileDeposit: () => ({ isPending: false }),
  useDepositPreview: () => ({
    data: view.preview ? { preview: view.preview } : undefined,
    error: view.error,
    isPending: false,
  }),
}));
const { Route } = await import("@/routes/reservations.$id");
const { DepositsCard } = await import("@/components/DepositsCard");
function render(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, node),
  );
}
beforeEach(() => {
  view.status = "confirmed";
  view.review = false;
  view.error = null;
  view.preview = undefined;
  view.deposits = [];
  view.guests = [];
  view.total = 0;
});
describe("saved reservation deposit flow", () => {
  it("defaults to the primary guest even when another guest is listed first, and offers all saved guests", () => {
    const guest = (id: string, isPrimary: boolean, mobile: string): ReservationDetailGuestDTO => ({
      id,
      guestId: id,
      fullName: `Guest ${id}`,
      isPrimary,
      mobile,
      email: `${id}@example.test`,
      nationality: null,
      nationalityCode: "MYS",
      identityType: null,
      identityNumberMasked: null,
      notes: null,
      addressLine1: null,
      addressLine2: null,
      addressLine3: null,
      city: null,
      postcode: null,
      countryCode: "MYS",
      stateCode: null,
      stateProvince: null,
      assignedReservationRoomId: null,
    });
    view.guests = [guest("second", false, "011-secondary"), guest("primary", true, "012-primary")];
    const html = render(createElement(Route.options.component!));
    expect(html).toContain("012-primary");
    expect(html).not.toContain("011-secondary");
    expect(html).toContain("All guests");
    expect(html).toContain('value="second"');
  });
  it("shows a compact posted receipt and saved payment name, with its posted total independent of empty entry fields", () => {
    view.deposits = [
      {
        id: "posted",
        status: "posted",
        amount: 50,
        currency: "MYR",
        n3DocCode: "OR2610/001",
        n3ReceiptId: "f13a847f-4535-4223-1a1e-08df1f9d36fb",
        customerLabel: "THX SDN BHD, KENNY WONG",
        accountLabel: "700-0310 — MAYBANK",
        paymentLines: [
          {
            code: "700-0310",
            displayName: "DuitNow",
            accountLabel: "700-0310 — MAYBANK",
            amount: 50,
          },
        ],
        description: "Deposit",
        createdByLabel: "KSLEE",
        createdAt: "2026-09-30T18:00:00Z",
        errorCode: null,
      },
    ];
    view.total = 50;
    const html = render(
      createElement(DepositsCard, {
        reservationId: "r",
        canView: true,
        canCreate: true,
        eligible: true,
      }),
    );
    expect(html).toContain("OR2610/001");
    expect(html).toContain("01/10/2026");
    expect(html).toContain("700-0310 (DuitNow)");
    expect(html).toContain("Total Deposits:");
    expect(html).toContain("RM 50.00");
    expect(html).not.toContain("N3 document</dt>");
    expect(html).not.toContain("Recorded by</dt>");
    expect(html).toContain('aria-label="Deposit OR2610/001 details"');
    expect(html).toContain('aria-label="About this deposit entry"');
    expect(html).toContain(
      'href="https://n3.qne.cloud/ar/or/detail/f13a847f-4535-4223-1a1e-08df1f9d36fb"',
    );
    expect(html).toContain("Print in N3");
    view.deposits[0].status = "unknown";
    const uncertain = render(
      createElement(DepositsCard, {
        reservationId: "r",
        canView: true,
        canCreate: true,
        eligible: true,
      }),
    );
    expect(uncertain).not.toContain("Print in N3");
    view.deposits[0].status = "posted";
    view.deposits[0].n3ReceiptId = "../../outside";
    expect(
      render(
        createElement(DepositsCard, {
          reservationId: "r",
          canView: true,
          canCreate: true,
          eligible: true,
        }),
      ),
    ).not.toContain("Print in N3");
    view.deposits[0].n3ReceiptId = "00000000-0000-0000-0000-000000000000";
    expect(
      render(
        createElement(DepositsCard, {
          reservationId: "r",
          canView: true,
          canCreate: true,
          eligible: true,
        }),
      ),
    ).not.toContain("Print in N3");
  });
  it("shows deposit entry before the folio on a checked-in reservation", () => {
    view.status = "checked_in";
    const html = render(createElement(Route.options.component!));
    expect(html).toContain("Add deposit");
    expect(html).toContain("Prepare Checkout");
    expect(html.indexOf(">Deposits<")).toBeLessThan(html.indexOf("Folio (preparation only)"));
  });
  it("shows deposit entry immediately on a saved confirmed reservation", () => {
    const html = render(createElement(Route.options.component!));
    expect(html).toContain("Add deposit");
    expect(html.indexOf(">Deposits<")).toBeLessThan(html.indexOf("Folio (preparation only)"));
  });
  it("keeps history but offers no deposit entry for a cancelled reservation", () => {
    view.status = "cancelled";
    const html = render(createElement(Route.options.component!));
    expect(html).toContain(">Deposits<");
    expect(html).not.toContain("Add deposit");
  });
  it("shows a failed preview without claiming a document can be posted", () => {
    view.review = true;
    view.error = { code: "n3_defaults_rate_invalid" };
    const html = render(
      createElement(DepositsCard, {
        reservationId: "r",
        canView: true,
        canCreate: true,
        eligible: true,
      }),
    );
    expect(html).toContain("exchange rate");
    expect(html).toContain("Nothing was posted");
    expect(html).not.toContain("It cannot be undone");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Confirm and post to N3/);
  });
  it("keeps the irreversible-posting warning when a valid preview is ready", () => {
    view.review = true;
    view.preview = {
      bookingReference: "BK260925001",
      customerLabel: "Walk in",
      currency: "MYR",
      amount: 50,
      warning: "This creates a real accounting document in N3.",
      paymentLines: [{ accountLabel: "DuitNow", amount: 50 }],
    };
    const html = render(
      createElement(DepositsCard, {
        reservationId: "r",
        canView: true,
        canCreate: true,
        eligible: true,
      }),
    );
    expect(html).toContain("MYR 50.00");
    expect(html).toContain("It cannot be undone");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Confirm and post to N3/);
  });
});
