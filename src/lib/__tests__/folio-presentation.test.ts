import { describe, expect, it } from "vitest";
import { folioLineTitle } from "../folio-presentation";

describe("guest-facing room charge", () => {
  it("removes the internal stock code and does not repeat the room name", () => {
    expect(
      folioLineTitle({
        lineType: "room_night",
        description: "Room charge — 777-ROOM-101 · HOTEL ROOM 101 - Essential",
        roomLabel: "777-ROOM-101 · HOTEL ROOM 101 - Essential",
      }),
    ).toBe("Room charge · HOTEL ROOM 101 - Essential");
  });
  it("preserves the description of non-room lines", () => {
    expect(
      folioLineTitle({ lineType: "add_on", description: "EXTRA PILLOW", roomLabel: null }),
    ).toBe("EXTRA PILLOW");
  });
});
