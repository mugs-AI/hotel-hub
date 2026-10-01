import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { N3IntegrationPanel, PropertyPanel } from "@/components/PropertySettingsPanels";
import type { SessionMe } from "@/lib/session-client";
import type { HotelSettingsDTO } from "@/lib/hotel-settings-client";

const state = vi.hoisted(() => ({ session: null as SessionMe | null }));
vi.mock("@/lib/session-client", async (original) => ({
  ...(await original<object>()),
  useSessionMe: () => ({ isLoading: false, data: state.session, refetch: async () => {} }),
  useSignOut: () => ({ mutate: () => {}, isPending: false }),
}));

const settings: HotelSettingsDTO = {
  tenantId: "tenant-ui",
  currency: "MYR",
  timezone: "Asia/Kuala_Lumpur",
  standardCheckInTime: "14:00",
  standardCheckOutTime: "12:00",
  postCheckInGuestEditPolicy: "contact_only",
  allowOwnerPrimaryGuestChangeAfterCheckIn: false,
  housekeepingMode: "simple",
  exceptionApprovalMode: "owner_approval",
  displaySize: 7,
  folioBodyPt: 9,
  folioNotePt: 6,
  folioContactAddress: "",
  folioContactPhone: "",
  folioContactEmail: "",
  paymentAccountAliases: {},
  paymentAccountVisibility: {},
  walkInCustomer: null,
};

beforeEach(() => {
  state.session = {
    authenticated: true,
    tenant: { tenantId: "tenant-ui", tenantCode: "UI-TEST", companyName: "Hotel UI Test" },
    user: { n3UserKey: "owner-ui", userName: "Owner UI", userEmail: "owner@example.test" },
    role: "owner",
    roleStatus: "assigned",
    roleReason: null,
    housekeepingMode: "simple",
    exceptionApprovalMode: "owner_approval",
    displaySize: 7,
  };
});

async function shell(path = "/") {
  const root = createRootRoute({
    component: () => createElement(AppShell, null, createElement("h1", null, "Workspace")),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function panel(component: typeof N3IntegrationPanel | typeof PropertyPanel) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(component, { settings, onChange: () => {}, onN3Unauthorized: () => {} }),
    ),
  );
}

describe("Compact navigation preserves access", () => {
  it("offers an accessible mobile menu and does not render deferred placeholders", async () => {
    const html = await shell();
    expect(html).toContain('aria-label="Open main menu"');
    expect(html).not.toMatch(/>Guests<|>Folios &amp; AR<|>Reports</);
    expect(html).toContain('href="/reservations"');
    expect(html).toContain('aria-current="page"');
  });

  it("does not expose Owner setup links to Front Desk", async () => {
    if (state.session?.authenticated) state.session.role = "front_desk";
    const html = await shell();
    expect(html).toContain('href="/reservations"');
    expect(html).not.toContain('href="/settings"');
    expect(html).toContain('href="/rooms-rates"');
  });

  it("keeps financial navigation away from a dedicated Housekeeper", async () => {
    if (state.session?.authenticated) {
      state.session.role = "housekeeper";
      state.session.housekeepingMode = "dedicated";
    }
    const html = await shell();
    expect(html).toContain('href="/housekeeping"');
    expect(html).not.toContain('href="/reservations"');
    expect(html).not.toContain('href="/departures"');
    expect(html).not.toContain('href="/settings"');
  });
});

describe("Settings card help", () => {
  it("removes the second financial-console entry while keeping integration controls", () => {
    const html = panel(N3IntegrationPanel);
    expect(html).not.toContain('href="/settings/n3-financial-verification"');
    expect(html).toContain("Payment method names");
    expect(html).toContain("Default walk-in customer");
  });

  it("puts property explanation behind an accessible info control", () => {
    const html = panel(PropertyPanel);
    expect(html).toContain('aria-label="About Property"');
    expect(html).not.toContain("Currency, timezone and the standard");
    expect(html).toContain("Standard check-in");
  });
});
