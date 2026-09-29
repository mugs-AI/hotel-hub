import type { FolioLineDTO } from "./folio-view";

/** Guest-facing room descriptions must never expose internal stock codes. */
export function folioLineTitle(
  line: Pick<FolioLineDTO, "lineType" | "description" | "roomLabel">,
): string {
  if (line.lineType !== "room_night") return line.description;
  const room = line.roomLabel?.trim() || "Room";
  return `Room charge · ${room.replace(/\b\d{3}-ROOM-\d+\s*[·:-]?\s*/gi, "").trim() || "Room"}`;
}
