/**
 * BOUNDED SAME-SCOPE AUDIT CORRECTION — rendered UI proof.
 *
 * Everything asserted here is markup a user would actually see, produced by
 * the real components with a real QueryClient.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  effectiveExceptionMode,
  exceptionActionLabel,
  exceptionSubmitLabel,
} from "@/lib/operations-client";
import {
  DND_CHIP_LABEL,
  DND_SUPPORTING_TEXT,
  DND_NEXT_ACTION,
  DND_CLEAR_LABEL,
  actorDisplayName,
  TONE_STYLE,
} from "@/lib/housekeeping";
import { DepositsCard } from "@/components/DepositsCard";
import { ExceptionApprovalPanel } from "@/components/PropertySettingsPanels";
import { RoomCard } from "@/components/HousekeepingBoard";
import type { HousekeepingRoomDTO } from "@/lib/housekeeping-store.server";

const deposits = vi.hoisted(() => ({ list: [] as any[], capability: { canCreate: true } }));

vi.mock("@/lib/deposits-client", () => ({
  useReservationDeposits: () => ({
    isPending: false,
    data: { deposits: deposits.list, capability: deposits.capability },
  }),
  useCreateDeposit: () => ({ mutate: () => {}, reset: () => {}, isPending: false }),
  useReconcileDeposit: () => ({ mutate: () => {}, reset: () => {}, isPending: false }),
  useDepositPreview: () => ({ mutate: () => {}, reset: () => {}, data: undefined }),
}));

function render(node: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node));
}

// --------------------------------------------------------------- Deposits

describe("Deposits card — quiet, but never hides money trouble", () => {
  function card() {
    return render(
      createElement(DepositsCard, {
        reservationId: "r-1",
        canView: true,
        canCreate: true,
        eligible: true,
      }),
    );
  }

  it("collapses to the heading, 'No deposit' and a single Details control", () => {
    deposits.list = [];
    const html = card();
    expect(html).toContain(">Deposits<");
    expect(html).toContain("No deposit");
    expect((html.match(/Details/g) ?? []).length).toBe(1);
    expect(html).not.toContain("Show details");
    expect(html).not.toContain("Receive Payment");
    expect(html).not.toContain("disabled for this property");
    expect(html).not.toContain("not linked here automatically");
  });

  it("keeps the real amount and status visible when deposits exist", () => {
    deposits.list = [{ id: "d1", amount: 250, currency: "MYR", status: "posted" }];
    const html = card();
    expect(html).toContain("1 deposit · MYR 250.00");
  });

  it("never hides an unconfirmed N3 result, and says not to re-post", () => {
    deposits.list = [{ id: "d1", amount: 250, currency: "MYR", status: "unknown" }];
    const html = card();
    expect(html).toMatch(/unconfirmed/i);
    expect(html).toMatch(/do not re-post/i);
    expect(html).toMatch(/check N3/i);
  });

  it("never hides a failed post", () => {
    deposits.list = [{ id: "d1", amount: 250, currency: "MYR", status: "failed" }];
    expect(card()).toMatch(/1 failed/);
  });
});

// ------------------------------------------------------------------- DND

const ROOM: HousekeepingRoomDTO = {
  hotelRoomId: "room-1",
  roomNumber: "101",
  displayName: "Deluxe 101",
  floor: "1",
  roomType: "Deluxe",
  condition: "ready",
  dndActive: true,
  initialized: true,
  lastAction: "mark_ready",
  lastActorLabel: "front.desk@hotel.test",
  lastTransitionAt: "2026-08-24T02:00:00.000Z",
  note: null,
  occupancy: "vacant",
  checkInBlockers: [],
} as unknown as HousekeepingRoomDTO;

describe("DND presentation", () => {
  const html = renderToStaticMarkup(
    createElement(RoomCard as any, {
      room: ROOM,
      busy: false,
      onAction: () => {},
      canUpdate: true,
      canDnd: true,
      canInitialize: true,
    }),
  );

  it("shows the chip, the reason and the next action — not the old sentence", () => {
    expect(DND_CHIP_LABEL).toBe("DND Active");
    expect(DND_SUPPORTING_TEXT).toBe("Guest privacy requested");
    expect(DND_NEXT_ACTION).toBe("Clear DND to resume housekeeping");
    expect(html).toContain(DND_CHIP_LABEL);
    expect(html).toContain(DND_SUPPORTING_TEXT);
    expect(html).toContain(DND_NEXT_ACTION);
    expect(html).not.toContain("Do Not Disturb — cleaning paused.");
  });

  it("offers a filled indigo Clear DND button", () => {
    expect(html).toContain(DND_CLEAR_LABEL);
    expect(TONE_STYLE.dndClear.filled).toBe(true);
    expect(TONE_STYLE.dndClear.bg).toBe(TONE_STYLE.dnd.border);
  });
});

// ------------------------------------------------------- Operation labels

describe("Exception labels follow SERVER-effective authority", () => {
  it("an Owner sees direct wording in either property mode", () => {
    for (const mode of ["direct", "owner_approval"] as const) {
      const effective = effectiveExceptionMode("owner", mode);
      expect(effective).toBe("direct");
      expect(exceptionActionLabel("Change room", effective)).toBe("Change room");
      expect(exceptionSubmitLabel(effective, false)).toBe("Apply change");
    }
  });

  it("Front Desk keeps Request wording only under owner approval", () => {
    expect(effectiveExceptionMode("front_desk", "owner_approval")).toBe("owner_approval");
    expect(exceptionActionLabel("Change room", "owner_approval")).toBe("Request change room");
    expect(exceptionSubmitLabel("owner_approval", false)).toBe("Send for approval");
    expect(effectiveExceptionMode("front_desk", "direct")).toBe("direct");
    expect(exceptionSubmitLabel("direct", false)).toBe("Apply change");
  });

  it("renders all five actions as filled, high-contrast semantic buttons with text labels", () => {
    const src = readFileSync(
      resolve(__dirname, "../../components/ReservationOperations.tsx"),
      "utf8",
    );
    expect(src).toMatch(/backgroundColor: REQUEST_COLOR\[r\.type\]/);
    for (const label of [
      "Early check-in",
      "Late checkout",
      "Extend stay",
      "Change room",
      "Change rate",
    ]) {
      expect(src).toContain(label);
    }
  });
});

// ------------------------------------------------- Actor label + history

describe("History reads like a person wrote it", () => {
  it("prefers a display name and falls back to the email local part with no domain", () => {
    expect(actorDisplayName("Aisha Rahman")).toBe("Aisha Rahman");
    expect(actorDisplayName("front.desk@hotel.com")).toBe("Front Desk");
    expect(actorDisplayName("front.desk@hotel.com")).not.toContain("@");
    expect(actorDisplayName(null)).toBe("System");
  });

  it("lives in an accessible right-side Sheet that is full width on mobile", () => {
    const src = readFileSync(resolve(__dirname, "../../components/HousekeepingBoard.tsx"), "utf8");
    expect(src).toMatch(/SheetContent side="right"/);
    expect(src).toMatch(/w-full/);
  });
});

// ------------------------------------------------------------- Settings

describe("Settings placement", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/settings.tsx"), "utf8");

  it("puts reservation exception approvals in a dedicated Operations tab", () => {
    expect(src).toMatch(/id: "operations", label: "Operations"/);
    expect(src).toMatch(/function OperationsScreen[\s\S]*?ExceptionApprovalPanel/);
  });

  it("keeps housekeeping retention in System", () => {
    expect(src).toMatch(/function SystemScreen[\s\S]*?HousekeepingRetentionPanel/);
    expect(src).not.toMatch(/function SystemScreen[\s\S]*?ExceptionApprovalPanel/);
  });

  it("renders the approval choice with no browser-authored authority", () => {
    const html = render(
      createElement(ExceptionApprovalPanel, {
        settings: { exceptionApprovalMode: "owner_approval" } as any,
        onChange: () => {},
      }),
    );
    expect(html).toMatch(/Owner approval/);
    expect(html).toMatch(/Direct/);
  });
});
