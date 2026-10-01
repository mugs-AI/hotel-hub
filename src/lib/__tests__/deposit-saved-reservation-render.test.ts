import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const view = vi.hoisted(() => ({
  status: "confirmed",
  error: null as { code: string } | null,
  review: false,
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
        guests: [],
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
  useReservationDeposits: () => ({ data: { deposits: [], capability: { canCreate: true } } }),
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
});
describe("saved reservation deposit flow", () => {
  it("shows deposit entry before the folio on a checked-in reservation", () => {
    view.status = "checked_in";
    const html = render(createElement(Route.options.component!));
    expect(html).toContain("Add deposit");
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
