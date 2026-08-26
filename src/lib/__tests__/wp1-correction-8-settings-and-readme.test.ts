// WP1 Correction 8 — P2 only.
// 1. Housekeeping workflow lives under Settings → System, not a top-level
//    "Housekeeping" settings tab.
// 2. README tells the truth about the WP1 Housekeeping candidate without
//    claiming acceptance or deployment.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const settings = readFileSync("src/routes/settings.tsx", "utf8");
const readme = readFileSync("README.md", "utf8");
const panels = readFileSync("src/components/PropertySettingsPanels.tsx", "utf8");

describe("Settings tab placement", () => {
  it("exposes a top-level System tab", () => {
    expect(settings).toMatch(/\{ id: "system", label: "System" \}/);
  });

  it("no longer exposes a top-level Housekeeping tab", () => {
    expect(settings).not.toMatch(/label: "Housekeeping"/);
    expect(settings).not.toMatch(/id: "housekeeping"/);
  });

  it("mounts the Housekeeping workflow section inside the System tab", () => {
    expect(settings).toMatch(/tab === "system"/);
    expect(settings).toMatch(/aria-label="Housekeeping workflow"/);
    expect(settings).toMatch(/<HousekeepingPanel settings=\{settings\} onChange=\{onChange\} \/>/);
  });

  it("keeps a single housekeeping control with simple and dedicated options", () => {
    expect(settings.match(/<HousekeepingPanel/g)?.length).toBe(1);
    expect(panels).toMatch(/Housekeeping workflow/);
    expect(panels).toMatch(/value: "simple" as const/);
    expect(panels).toMatch(/value: "dedicated" as const/);
    expect(panels).toMatch(/housekeepingMode: mode/);
  });

  it("keeps Settings owner-only", () => {
    expect(settings).toMatch(/hasPermission\(role, "hotel:setup"\)/);
    expect(settings).toMatch(/Settings are Owner-only/);
  });
});

describe("README candidate truth", () => {
  it("does not list housekeeping workflow as not built", () => {
    expect(readme).not.toMatch(/housekeeping & maintenance workflow/i);
    expect(readme).not.toMatch(/housekeeping workflow;/i);
  });

  it("does not claim WP1 is accepted, deployed or production-verified", () => {
    expect(readme).not.toMatch(/WP1[^\n]*(accepted|deployed|production-verified|live)/i);
    expect(readme).toMatch(/not formally\s*\n?accepted, not deployed, not production-verified/i);
  });

  it("describes the candidate housekeeping behaviour", () => {
    expect(readme).toMatch(/Simple \/ Front Desk mode/);
    expect(readme).toMatch(/Dedicated Housekeeping mode/);
    expect(readme).toMatch(/Dirty → Cleaning → Inspected → Ready/);
    expect(readme).toMatch(/Do Not Disturb/);
    expect(readme).toMatch(/room-change-away Dirty handoff with fail-closed reconciliation/);
    expect(readme).toMatch(/`Ready` means housekeeping-cleared only/);
    expect(readme).toMatch(/Settings → System → Housekeeping workflow/);
  });

  it("keeps maintenance as future WP2 work", () => {
    expect(readme).toMatch(/maintenance workflow \(WP2\)/);
  });

  it("keeps Prepare Checkout read-only", () => {
    expect(readme).toMatch(/Departures & Prepare Checkout\*\* — \*\*read-only\*\*/);
  });
});
