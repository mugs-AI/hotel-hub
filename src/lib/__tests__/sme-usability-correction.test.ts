import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  exceptionActionLabel,
  exceptionModeHint,
  exceptionSubmitLabel,
} from "@/lib/operations-client";
import { actorDisplayName, historyEntryLine, TONE_STYLE } from "@/lib/housekeeping";
import { depositsAttentionLine, depositsHeadline } from "@/components/DepositsCard";

describe("A — exception actions tell the truth about approval policy", () => {
  it("labels direct actions as actions, not requests", () => {
    expect(exceptionActionLabel("Early check-in", "direct")).toBe("Early check-in");
    expect(exceptionActionLabel("Early check-in", "owner_approval")).toBe("Request early check-in");
  });

  it("uses the matching submit label and hint", () => {
    expect(exceptionSubmitLabel("direct", false)).toBe("Apply now");
    expect(exceptionSubmitLabel("owner_approval", false)).toBe("Send for approval");
    expect(exceptionSubmitLabel("direct", true)).toBe("Applying…");
    expect(exceptionModeHint("owner_approval")).toMatch(/Owner approval/);
    expect(exceptionModeHint("direct")).toMatch(/recorded/);
  });

  it("renders every exception action as a filled semantic button", () => {
    const src = readFileSync(
      resolve(__dirname, "../../components/ReservationOperations.tsx"),
      "utf8",
    );
    expect(src).toMatch(/backgroundColor: REQUEST_COLOR\[r\.type\]/);
    expect(src).not.toMatch(/Request \{r\.label\.toLowerCase\(\)\}/);
  });
});

describe("B — deposits card is quiet by default", () => {
  it("summarises the money in one line", () => {
    expect(depositsHeadline({ count: 0, currency: null, total: 0 })).toBe("No deposit");
    expect(depositsHeadline({ count: 1, currency: "MYR", total: 250 })).toBe(
      "1 deposit · MYR 250.00",
    );
    expect(depositsHeadline({ count: 2, currency: "MYR", total: 400 })).toBe(
      "2 deposits · MYR 400.00",
    );
  });

  it("never hides an unconfirmed or failed post behind the collapsed state", () => {
    expect(depositsAttentionLine([{ status: "posted" }])).toBeNull();
    expect(depositsAttentionLine([{ status: "failed" }])).toMatch(/1 failed/);
    expect(depositsAttentionLine([{ status: "unknown" }])).toMatch(/unconfirmed/);
  });
});

describe("C/D — DND presentation and housekeeping history drawer", () => {
  it("clears DND with the indigo counterpart of setting it", () => {
    expect(TONE_STYLE.dndClear.filled).toBe(true);
    expect(TONE_STYLE.dndClear.bg).toBe(TONE_STYLE.dnd.border);
  });

  it("shows human names, falling back to the email local part", () => {
    expect(actorDisplayName(null)).toBe("System");
    expect(actorDisplayName("Aisha Rahman")).toBe("Aisha Rahman");
    expect(actorDisplayName("front.desk@hotel.com")).toBe("Front Desk");
  });

  it("writes a compact timeline line", () => {
    expect(historyEntryLine({ action: "mark_ready", previousCondition: null })).toBe("Mark ready");
    expect(
      historyEntryLine({
        action: "start_cleaning",
        previousCondition: "dirty",
        resultingCondition: "cleaning",
      }),
    ).toBe("Start cleaning · dirty → cleaning");
  });

  it("renders history in a right-side drawer", () => {
    const src = readFileSync(resolve(__dirname, "../../components/HousekeepingBoard.tsx"), "utf8");
    expect(src).toMatch(/SheetContent side="right"/);
  });
});

describe("E/F — Owner settings", () => {
  it("exposes retention purge and approval policy in the System tab", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/settings.tsx"), "utf8");
    expect(src).toMatch(/ExceptionApprovalPanel/);
    expect(src).toMatch(/HousekeepingRetentionPanel/);
  });

  it("purges through the Owner-only server route, never client-side deletion", () => {
    const src = readFileSync(
      resolve(__dirname, "../../components/PropertySettingsPanels.tsx"),
      "utf8",
    );
    expect(src).toMatch(/"\/api\/hotel\/housekeeping\/purge"/);
    expect(src).toMatch(/exceptionApprovalMode: mode/);
  });
});
