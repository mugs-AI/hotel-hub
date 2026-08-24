/**
 * WP1 HOUSEKEEPING UX — IMMEDIATE PER-ROOM RESPONSE WITHOUT WEAKENED AUTHORITY.
 *
 * The card the user clicked repaints from the SERVER's own authoritative room
 * DTO, immediately. Nothing is guessed on the client, no fake state is ever
 * patched, and a post-write read failure never fakes a rollback — the
 * background board resync remains the recovery path.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addPendingRoom, removePendingRoom } from "@/components/HousekeepingBoard";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BOARD = read("../../components/HousekeepingBoard.tsx");
const CLIENT = read("../housekeeping-client.ts");
const ROUTE = read("../../routes/api/hotel/housekeeping.rooms.$roomId.ts");
const STORE = read("../housekeeping-store.server.ts");

describe("WP1 per-room responsiveness", () => {
  it("tracks a SET of pending rooms, not a single scalar room id", () => {
    expect(BOARD).toContain(
      "const [pendingRoomIds, setPendingRoomIds] = useState<ReadonlySet<string>>",
    );
    expect(BOARD).not.toContain("pendingRoomId === room.roomId");
    expect(BOARD).not.toMatch(/useState<string \| null>\(null\);\s*\n\s*const rooms/);
    expect(BOARD).toContain("busy={pendingRoomIds.has(room.roomId)}");
    expect(BOARD).toContain("setPendingRoomIds((prev) => addPendingRoom(prev, payload.roomId))");
    // No global board-wide disabling from the mutation object.
    expect(BOARD).not.toContain("act.isPending");
    expect(BOARD).not.toContain("disabled={act.isPending}");
  });

  it("only the clicked rooms show Updating… / aria-busy", () => {
    expect(BOARD).toContain("aria-busy={busy}");
    // A busy room is disabled; the control may ALSO be disabled when it is
    // shown-but-not-yet-available (e.g. DND before initialisation).
    expect(BOARD).toContain("disabled={busy || disabled === true}");
    expect(BOARD).toContain('{busy ? "Updating…" : children}');
    expect(BOARD).toContain('busy ? "Updating…"');
    const busyProps = BOARD.match(/busy=\{[^}]+\}/g) ?? [];
    for (const p of busyProps) {
      expect(p === "busy={busy}" || p === "busy={pendingRoomIds.has(room.roomId)}").toBe(true);
    }
  });

  it("removes only the settled room in onSettled so a failed action never freezes a card", () => {
    expect(BOARD).toContain(
      "onSettled: () => setPendingRoomIds((prev) => removePendingRoom(prev, payload.roomId))",
    );
    expect(BOARD).not.toContain("setPendingRoomId(null)");
  });
});

describe("WP1 overlapping per-room pending lifecycle", () => {
  const A = "room-a";
  const B = "room-b";
  const C = "room-c";

  it("starting A marks only A pending", () => {
    const s = addPendingRoom(new Set<string>(), A);
    expect(s.has(A)).toBe(true);
    expect(s.has(B)).toBe(false);
    expect(s.has(C)).toBe(false);
  });

  it("starting B while A is pending keeps BOTH pending and leaves C enabled", () => {
    const s = addPendingRoom(addPendingRoom(new Set<string>(), A), B);
    expect(s.has(A)).toBe(true);
    expect(s.has(B)).toBe(true);
    expect(s.has(C)).toBe(false);
    expect(s.size).toBe(2);
  });

  it("A settling removes ONLY A; B stays pending until it settles itself", () => {
    const both = addPendingRoom(addPendingRoom(new Set<string>(), A), B);
    const afterA = removePendingRoom(both, A);
    expect(afterA.has(A)).toBe(false);
    expect(afterA.has(B)).toBe(true);
    const afterB = removePendingRoom(afterA, B);
    expect(afterB.has(B)).toBe(false);
    expect(afterB.size).toBe(0);
  });

  it("a failed action removes only that room from pending", () => {
    const both = addPendingRoom(addPendingRoom(new Set<string>(), A), B);
    // B failed -> its onSettled still removes B only.
    const afterFailB = removePendingRoom(both, B);
    expect(afterFailB.has(A)).toBe(true);
    expect(afterFailB.has(B)).toBe(false);
  });

  it("helpers are immutable and idempotent", () => {
    const base = addPendingRoom(new Set<string>(), A);
    const again = addPendingRoom(base, A);
    expect(again).not.toBe(base);
    expect(again.size).toBe(1);
    expect(base.has(A)).toBe(true);
    const removedTwice = removePendingRoom(removePendingRoom(base, A), A);
    expect(removedTwice.size).toBe(0);
    expect(base.has(A)).toBe(true);
  });
});

describe("WP1 server authority on the write path", () => {
  it("the write route returns the authoritative single-room DTO", () => {
    expect(ROUTE).toContain("roomViewOrNull");
    expect(ROUTE).toContain("getHousekeepingRoomView");
    expect(STORE).toContain("export async function getHousekeepingRoomView");
    expect(STORE).toContain("function buildRoomDTO");
  });

  it("a post-write read failure returns null instead of failing the write", () => {
    expect(ROUTE).toMatch(
      /try \{\s*return await getHousekeepingRoomView\(input\);\s*\} catch \{\s*return null;\s*\}/,
    );
  });

  it("the cache patch uses the server DTO only, and skips when absent", () => {
    expect(CLIENT).toContain("const room = result?.room;");
    // Missing DTO → no patch at all, resync instead of inventing a state.
    expect(CLIENT).toMatch(/if \(!room\) \{[\s\S]*invalidateQueries[\s\S]*return;/);
    expect(CLIENT).toContain("r.roomId === room.roomId ? room : r");
    // No client-side next-condition guess anywhere.
    expect(CLIENT).not.toContain("onMutate");
    expect(CLIENT).not.toMatch(/nextCondition|NEXT_CONDITION|transitionMatrix/);
    expect(BOARD).not.toMatch(/nextCondition|NEXT_CONDITION|transitionMatrix/);
  });

  it("errors never patch a fake state; the board always background-resyncs", () => {
    // A failed action resyncs immediately; a successful one schedules a
    // debounced authoritative resync so it never races the card repaint.
    expect(CLIENT).toMatch(/onError: \(\) => \{[\s\S]*invalidateQueries/);
    expect(CLIENT).toContain("BOARD_RESYNC_DELAY_MS");
    // setQueryData happens only inside onSuccess.
    const successIdx = CLIENT.indexOf("onSuccess:");
    const patchIdx = CLIENT.indexOf("qc.setQueryData");
    expect(successIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(successIdx);
    expect(CLIENT.match(/qc\.setQueryData/g)!.length).toBe(1);
    expect(CLIENT).not.toContain("onError:");
  });

  it("the server still decides transitions, DND authority and mode role authority", () => {
    expect(BOARD).toContain("room.availableTransitions.filter");
    expect(BOARD).toContain("canDnd && room.canSetDnd");
    expect(BOARD).toContain("canDnd && room.canClearDnd");
    expect(BOARD).toContain("board.data!.authority");
    expect(STORE).toContain("assertDndAuthorized");
    expect(ROUTE).toContain("requirePermission");
  });
});
