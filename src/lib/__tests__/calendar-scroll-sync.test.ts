import { describe, expect, it } from "vitest";
import * as calendarUi from "@/lib/reservations-ui";

type ScrollPeer = { scrollLeft: number };
const synchronize = (
  calendarUi as unknown as {
    syncCalendarScroll: (source: ScrollPeer, target: ScrollPeer | null) => void;
  }
).syncCalendarScroll;

function peer(position: number) {
  let value = position;
  const writes: number[] = [];
  return {
    writes,
    get scrollLeft() {
      return value;
    },
    set scrollLeft(next: number) {
      writes.push(next);
      value = next;
    },
  };
}

describe("Calendar scrollbar synchronization", () => {
  it("does not assign the main position again when the top track echoes a smooth-scroll frame", () => {
    expect(synchronize).toBeTypeOf("function");
    const main = peer(48.25);
    const top = peer(0);
    synchronize(main, top);
    synchronize(top, main);
    expect(top.writes).toEqual([48.25]);
    expect(main.writes).toEqual([]);
  });

  it("ignores subpixel rounding echoes so a smooth scroll is not cancelled", () => {
    expect(synchronize).toBeTypeOf("function");
    const main = peer(48.25);
    synchronize({ scrollLeft: 48 }, main);
    expect(main.writes).toEqual([]);
  });

  it("copies a user's top-track movement to the main calendar", () => {
    expect(synchronize).toBeTypeOf("function");
    const main = peer(0);
    synchronize({ scrollLeft: 672 }, main);
    expect(main.scrollLeft).toBe(672);
    expect(main.writes).toEqual([672]);
  });
});
