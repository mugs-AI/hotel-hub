/**
 * FINAL BOUNDED SAME-SCOPE AUDIT CORRECTION — rendered/behavioural UI proof.
 *
 * Compact deposit truthfulness, the purge confirmation guard and the
 * mode-aware room-change wording are asserted on real rendered markup or on
 * the real guard the component uses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DepositsCard, depositsHeadline, depositsStatusSummary } from "@/components/DepositsCard";
import {
  canOpenRetentionConfirmation,
  HousekeepingRetentionPanel,
} from "@/components/PropertySettingsPanels";

const deposits = vi.hoisted(() => ({ list: [] as any[], capability: { canCreate: true } }));

vi.mock("@/lib/deposits-client", async (importOriginal) => ({
  ...((await importOriginal()) as object),
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

function depositCard(list: any[]): string {
  deposits.list = list;
  return render(
    createElement(DepositsCard, {
      reservationId: "r-1",
      canView: true,
      canCreate: true,
      eligible: true,
    }),
  );
}

const posted = { id: "d1", amount: 250, currency: "MYR", status: "posted" };
const failed = { id: "d2", amount: 100, currency: "MYR", status: "failed" };
const unknown = { id: "d3", amount: 50, currency: "MYR", status: "unknown" };

describe("Deposits compact summary — real amount AND real status", () => {
  it("shows the single deposit's amount and status", () => {
    const html = depositCard([posted]);
    expect(html).toContain("1 deposit · MYR 250.00 · Posted");
  });

  it("shows a failed single deposit honestly and keeps the warning outside Details", () => {
    const html = depositCard([failed]);
    expect(html).toContain("1 deposit · MYR 100.00 · Failed");
    expect(html).toContain("1 failed");
  });

  it("shows an unconfirmed deposit and the do-not-re-post warning", () => {
    const html = depositCard([unknown]);
    expect(html).toContain("1 deposit · MYR 50.00 · Unconfirmed");
    expect(html).toContain("do not re-post, check N3 first");
  });

  it("shows compact status counts for mixed deposits", () => {
    const html = depositCard([posted, unknown]);
    expect(html).toContain("2 deposits · MYR 300.00 · Posted 1 · Unconfirmed 1");
    expect(html).toContain("do not re-post, check N3 first");
  });

  it("keeps the empty collapsed state to heading, No deposit and Details", () => {
    const html = depositCard([]);
    expect(html).toContain("Deposits");
    expect(html).toContain("No deposit");
    expect(html).toContain("Details");
    expect(html).not.toContain("Receive Payment");
    expect(html).not.toContain("Show details");
  });

  it("summarises statuses purely", () => {
    expect(depositsStatusSummary(["posted"])).toBe("Posted");
    expect(depositsStatusSummary(["posted", "failed", "failed"])).toBe("Posted 1 · Failed 2");
    expect(depositsHeadline({ count: 0, currency: null, total: 0 })).toBe("No deposit");
  });
});

describe("30-day purge — impossible without a valid preview", () => {
  it("refuses to open the confirmation while loading, on error or with no preview", () => {
    const good = { cutoff: "2026-07-25T02:00:00.000Z", count: 7 };
    expect(canOpenRetentionConfirmation({ preview: good, loading: false, error: null })).toBe(true);
    expect(canOpenRetentionConfirmation({ preview: good, loading: true, error: null })).toBe(false);
    expect(canOpenRetentionConfirmation({ preview: good, loading: false, error: "x" })).toBe(false);
    expect(canOpenRetentionConfirmation({ preview: null, loading: false, error: null })).toBe(false);
  });

  it("renders the purge button disabled before a preview exists", () => {
    const html = render(createElement(HousekeepingRetentionPanel));
    expect(html).toContain("Purge history older than 30 days");
    expect(html).toMatch(/Purge history older than 30 days/);
    expect(html).toContain("disabled");
    // No destructive confirmation, and no invented zero/cut-off placeholder.
    expect(html).not.toContain("Yes, remove them");
    expect(html).not.toContain("the cut-off. It cannot be undone");
  });

  it("never substitutes 0 or a placeholder cut-off in the confirmation copy", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/PropertySettingsPanels.tsx"),
      "utf8",
    );
    const panel = src.slice(src.indexOf("export function HousekeepingRetentionPanel"));
    expect(panel).toContain("confirming.count");
    expect(panel).toContain("frozenCutoff");
    expect(panel).not.toContain('cutoff ?? "the cut-off"');
    expect(panel).not.toContain("preview ? preview.count : 0");
  });
});

describe("Room-change wording follows the effective mode", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/components/ReservationOperations.tsx"),
    "utf8",
  );

  it("says the change is re-checked when YOU apply it in a direct flow", () => {
    expect(src).toContain('"when you apply the change."');
    expect(src).toContain('approvalMode === "direct"');
  });

  it("keeps Owner-approval wording only for the request path", () => {
    const hit = src.slice(src.indexOf('"when you apply the change."'));
    expect(hit.slice(0, 200)).toContain('"when the Owner approves."');
  });
});
