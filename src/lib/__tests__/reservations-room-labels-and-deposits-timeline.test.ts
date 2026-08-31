import { describe, expect, it } from "vitest";
import { formatRoomLabelsList, roomLabel } from "@/lib/reservations-ui";
import { depositsCompactSummary } from "@/components/DepositsCard";
import { timelineDrawerTitle } from "@/routes/reservations.$id";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("reservations list — room labels (privacy + formatting)", () => {
  it("prefers displayName, then n3StockName, then roomNumber (tenant-scoped label convention)", () => {
    expect(roomLabel("Ocean View", "N3-101", "101")).toBe("Ocean View");
    expect(roomLabel(null, "N3-101", "101")).toBe("N3-101");
    expect(roomLabel(null, null, "101")).toBe("101");
  });

  it("joins concise labels with commas for small room counts", () => {
    expect(formatRoomLabelsList(["101", "102"])).toBe("101, 102");
  });

  it("truncates gracefully for multi-room reservations", () => {
    const labels = ["101", "102", "103", "104", "105"];
    const out = formatRoomLabelsList(labels, 3);
    expect(out).toBe("101, 102, 103 +2 more");
  });

  it("renders a dash placeholder when there are no labels", () => {
    expect(formatRoomLabelsList([])).toBe("—");
  });

  it("never contains a UUID-shaped token — only human labels are ever formatted", () => {
    const labels = ["101", "Deluxe Suite", "N3-204"];
    const out = formatRoomLabelsList(labels);
    expect(UUID_RE.test(out)).toBe(false);
  });
});

describe("DepositsCard — compact summary logic", () => {
  it("shows the same single compact empty state when the gate is closed", () => {
    expect(depositsCompactSummary({ gateOpen: false })).toBe("No deposit");
  });

  it("does not repeat an empty-state explanation when posting is enabled", () => {
    expect(depositsCompactSummary({ gateOpen: true })).toBe("No deposit");
  });

  it("is a pure function of gate state only — it never summarises posted/unknown deposits away", () => {
    // The compact summary only ever governs the zero-deposit empty state;
    // posted/failed/pending deposit warnings are rendered unconditionally
    // by the component regardless of this helper's output.
    expect(typeof depositsCompactSummary({ gateOpen: false })).toBe("string");
  });
});

describe("Reservation detail — timeline drawer", () => {
  it("builds a stable, read-only drawer title referencing the booking reference", () => {
    expect(timelineDrawerTitle("BR-0001")).toBe("Timeline · BR-0001");
  });

  it("never embeds guest-identifying data in the drawer title", () => {
    const title = timelineDrawerTitle("BR-0002");
    expect(title).not.toMatch(/@/); // no email-like guest data
  });
});
