import { describe, expect, it } from "vitest";
import { WorkspaceStore, workspaceTab } from "@/lib/workspace-tabs";
const id = "11111111-1111-4111-8111-111111111111";
const tab = workspaceTab(`/reservations/${id}`, {}, "owner", "dedicated")!;
describe("opened HotelHub workspaces", () => {
  it("updates view metadata on an already opened booking without discarding its draft", () => {
    const store = new WorkspaceStore();
    store.open({ key: tab.key, label: "BK260920001", href: tab.href });
    store.setDraft(tab.key, "deposit", "50.00", true);
    store.open({ ...tab, label: "BK260920001" });
    expect(store.getSnapshot().tabs[0].view).toBe("reservation");
    expect(store.getDraft(tab.key, "deposit", "")).toBe("50.00");
  });
  it("keeps a loaded booking reference and deposit draft when switching checkout and reservation views", () => {
    const store = new WorkspaceStore();
    store.open(tab);
    store.label(tab.key, "BK260920001");
    store.setDraft(tab.key, "deposit", "50.00", true);
    store.open(workspaceTab(`/reservations/${id}/checkout`, {}, "owner", "dedicated")!);
    expect(store.getSnapshot().tabs).toHaveLength(1);
    expect(store.getSnapshot().tabs[0]).toMatchObject({ label: "BK260920001", view: "checkout" });
    store.open(workspaceTab(`/reservations/${id}`, {}, "owner", "dedicated")!);
    expect(store.getSnapshot().tabs[0]).toMatchObject({
      label: "BK260920001",
      view: "reservation",
    });
    expect(store.getDraft(tab.key, "deposit", "")).toBe("50.00");
  });
  it("deduplicates a reservation and keeps its editor as the last open view", () => {
    const store = new WorkspaceStore();
    store.open(tab);
    store.open(workspaceTab(`/reservations/${id}/edit`, {}, "owner", "dedicated")!);
    expect(store.getSnapshot().tabs).toHaveLength(1);
    expect(store.getSnapshot().tabs[0].href).toBe(`/reservations/${id}/edit`);
  });
  it("retains entered payment values while another workspace is opened", () => {
    const store = new WorkspaceStore();
    store.open(tab);
    store.setDraft(tab.key, "deposit", [{ amount: "40.30" }], true);
    store.open(workspaceTab("/housekeeping", {}, "owner", "dedicated")!);
    expect(store.getDraft(tab.key, "deposit", [])).toEqual([{ amount: "40.30" }]);
    expect(store.needsConfirmation(tab.key)).toBe(true);
    expect(store.close(tab.key, false)).toBe(false);
    expect(store.getSnapshot().tabs).toHaveLength(2);
    expect(store.close(tab.key, true)).toBe(true);
    expect(store.getDraft(tab.key, "deposit", [])).toEqual([]);
  });
  it("does not share drafts or views between session stores", () => {
    const first = new WorkspaceStore(),
      second = new WorkspaceStore();
    first.setDraft(tab.key, "deposit", "50.00", true);
    first.rememberScroll(tab.href, { x: 0, y: 650 });
    expect(second.getDraft(tab.key, "deposit", "")).toBe("");
    expect(second.scroll(tab.href)).toEqual({ x: 0, y: 0 });
  });
  it("keeps calendar range while rejecting token/unrestricted paths", () => {
    expect(
      workspaceTab(
        "/reservations/calendar",
        { startDate: "2026-10-01", days: 30, token: "do-not-keep" },
        "owner",
        "simple",
      )?.href,
    ).toBe("/reservations/calendar?startDate=2026-10-01&days=30");
    expect(workspaceTab("/api/hotel/reservations", {}, "owner", "simple")).toBeNull();
    expect(workspaceTab("/reservations/bad-id", {}, "owner", "simple")).toBeNull();
    expect(workspaceTab(`/reservations/${id}/folio-print`, {}, "owner", "simple")).toBeNull();
  });
  it("filters tabs with HotelHub permissions and housekeeping mode", () => {
    expect(workspaceTab("/settings", {}, "front_desk", "dedicated")).toBeNull();
    expect(workspaceTab("/reservations", {}, "housekeeper", "dedicated")).toBeNull();
    expect(workspaceTab("/housekeeping", {}, "housekeeper", "simple")).toBeNull();
    expect(workspaceTab("/housekeeping", {}, "housekeeper", "dedicated")?.label).toBe(
      "Housekeeping",
    );
  });
  it("notifies mounted draft consumers and resets the close guard when cleared", () => {
    const store = new WorkspaceStore();
    let updates = 0;
    const stop = store.subscribe(() => updates++);
    store.setDraft(tab.key, "deposit", "50.00", true);
    store.setDraft(tab.key, "deposit", "", false);
    expect(updates).toBe(2);
    expect(store.needsConfirmation(tab.key)).toBe(false);
    stop();
  });
  it("cannot discard a started or uncertain financial attempt by closing its tab", () => {
    const store = new WorkspaceStore();
    store.open(tab);
    store.setDraft(tab.key, "deposit-attempt", { phase: "unknown" }, true, "Check N3 first.");
    expect(store.close(tab.key, true)).toBe(false);
    expect(store.closeReason(tab.key)).toBe("Check N3 first.");
    store.setDraft(tab.key, "deposit-attempt", null, false);
    expect(store.close(tab.key, true)).toBe(true);
  });
});
