/**
 * WP1 HOUSEKEEPING UX — VOCABULARY + SEMANTIC COLOUR.
 *
 * Colour carries meaning, but never alone: every action and every condition
 * also states its own words. Red is reserved for blocked/error and must never
 * mean the normal Dirty lifecycle state.
 *
 * Presentation-only guards. No lifecycle, authority or gate is changed here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONDITION_LABELS,
  CONDITION_STYLE,
  HK_COLORS,
  TONE_STYLE,
  TRANSITION_LABELS,
  TRANSITION_TONE,
  DND_SET_LABEL,
} from "@/lib/housekeeping";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BOARD = read("../../components/HousekeepingBoard.tsx");

describe("WP1 action vocabulary", () => {
  it("uses the approved, result-stating labels", () => {
    expect(TRANSITION_LABELS.finish_cleaning).toBe("Finish & mark inspected");
    expect(TRANSITION_LABELS.mark_ready).toBe("Mark Ready");
    expect(TRANSITION_LABELS.revert_to_cleaning).toBe("Send back to Cleaning");
    expect(TRANSITION_LABELS.mark_dirty).toBe("Mark dirty");
    expect(TRANSITION_LABELS.start_cleaning).toBe("Start cleaning");
  });

  it("renders explicit set-up labels for an uninitialised room", () => {
    expect(BOARD).toContain("Set up as Ready");
    expect(BOARD).toContain("Set up as Dirty");
    // The set-DND label is now a single shared constant, rendered in both the
    // enabled and the visible-but-disabled states.
    expect(DND_SET_LABEL).toBe("Set Do Not Disturb");
    expect(BOARD).toContain("{DND_SET_LABEL}");
    expect(BOARD).toContain("{DND_CLEAR_LABEL}");
  });

  it("never shows an internal transition code as a label", () => {
    expect(BOARD).not.toContain(">finish_cleaning<");
    expect(BOARD).toContain("TRANSITION_LABELS[t]");
  });
});

describe("WP1 semantic tones", () => {
  it("Set up as Ready uses the positive apple-green tone", () => {
    expect(BOARD).toMatch(/tone="positive"[\s\S]{0,120}Set up as Ready/);
    expect(TONE_STYLE.positive.bg).toBe(HK_COLORS.appleGreen);
  });

  it("Set up as Dirty uses the corrective amber tone", () => {
    expect(BOARD).toMatch(/tone="corrective"[\s\S]{0,120}Set up as Dirty/);
    expect(TONE_STYLE.corrective.border).toBe(HK_COLORS.amber);
    expect(TONE_STYLE.corrective.bg).toBe(HK_COLORS.amberSoft);
  });

  it("Mark dirty uses the corrective amber tone", () => {
    expect(TRANSITION_TONE.mark_dirty).toBe("corrective");
    expect(TONE_STYLE[TRANSITION_TONE.mark_dirty].border).toBe(HK_COLORS.amber);
  });

  it("Start cleaning uses the work/teal tone", () => {
    expect(TRANSITION_TONE.start_cleaning).toBe("work");
    expect(TONE_STYLE.work.bg).toBe(HK_COLORS.teal);
  });

  it("Finish & mark inspected uses the blue inspection tone", () => {
    expect(TRANSITION_TONE.finish_cleaning).toBe("inspect");
    expect(TONE_STYLE.inspect.bg).toBe(HK_COLORS.blue);
  });

  it("Mark Ready uses the apple-green positive tone", () => {
    expect(TRANSITION_TONE.mark_ready).toBe("positive");
    expect(TONE_STYLE.positive.bg).toBe(HK_COLORS.appleGreen);
  });

  it("Send back to Cleaning uses the corrective amber tone", () => {
    expect(TRANSITION_TONE.revert_to_cleaning).toBe("corrective");
    expect(TONE_STYLE.corrective.border).toBe(HK_COLORS.amber);
  });

  it("Do Not Disturb has its own distinct indigo tone", () => {
    expect(TONE_STYLE.dnd.border).toBe(HK_COLORS.indigo);
    expect(TONE_STYLE.dnd.bg).toBe(HK_COLORS.indigoSoft);
    for (const tone of ["positive", "work", "inspect", "corrective"] as const) {
      expect(TONE_STYLE[tone].border).not.toBe(HK_COLORS.indigo);
    }
    expect(BOARD).toMatch(/tone="dnd"/);
  });
});

describe("WP1 condition chips follow the same semantics", () => {
  it("maps each condition to its lifecycle colour", () => {
    expect(CONDITION_STYLE.dirty.fg).toBe(HK_COLORS.amberInk);
    expect(CONDITION_STYLE.cleaning.fg).toBe(HK_COLORS.tealInk);
    expect(CONDITION_STYLE.inspected.fg).toBe(HK_COLORS.blue);
    expect(CONDITION_STYLE.ready.fg).toBe(HK_COLORS.appleGreenInk);
  });

  it("never uses red for the normal Dirty lifecycle state", () => {
    for (const condition of ["dirty", "cleaning", "inspected", "ready"] as const) {
      expect(CONDITION_STYLE[condition].fg).not.toBe(HK_COLORS.red);
      expect(CONDITION_STYLE[condition].bg).not.toBe(HK_COLORS.redSoft);
    }
    for (const tone of Object.values(TONE_STYLE)) {
      expect(tone.bg).not.toBe(HK_COLORS.red);
      expect(tone.border).not.toBe(HK_COLORS.red);
    }
  });

  it("keeps state words alongside colour so colour is never the only signal", () => {
    expect(CONDITION_LABELS.dirty).toBeTruthy();
    expect(BOARD).toContain("CONDITION_LABELS[room.condition]");
    expect(BOARD).toContain('"Not set up"');
    expect(BOARD).toContain("Next: {room.nextStep}");
    // Every summary tile carries a text label next to its number.
    expect(BOARD).toContain('label="Dirty"');
    expect(BOARD).toContain('label="Ready"');
    expect(BOARD).toContain('label="Do Not Disturb"');
  });
});
