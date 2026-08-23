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

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BOARD = read("../../components/HousekeepingBoard.tsx");
const CLIENT = read("../housekeeping-client.ts");
const ROUTE = read("../../routes/api/hotel/housekeeping.rooms.$roomId.ts");
const STORE = read("../housekeeping-store.server.ts");

describe("WP1 per-room responsiveness", () => {
  it("tracks pending state per room, not for the whole board", () => {
    expect(BOARD).toContain("const [pendingRoomId, setPendingRoomId] = useState<string | null>");
    expect(BOARD).toContain("setPendingRoomId(payload.roomId)");
    expect(BOARD).toContain("busy={pendingRoomId === room.roomId}");
    // No global board-wide disabling from the mutation object.
    expect(BOARD).not.toContain("act.isPending");
    expect(BOARD).not.toContain("disabled={act.isPending}");
  });

  it("only the clicked room shows Updating… / aria-busy", () => {
    expect(BOARD).toContain("aria-busy={busy}");
    expect(BOARD).toContain("disabled={busy}");
    expect(BOARD).toContain('{busy ? "Updating…" : children}');
    expect(BOARD).toContain('busy ? "Updating…"');
    // `busy` is derived only from the single pending room id.
    const busyProps = BOARD.match(/busy=\{[^}]+\}/g) ?? [];
    for (const p of busyProps) {
      expect(p === "busy={busy}" || p === "busy={pendingRoomId === room.roomId}").toBe(true);
    }
  });

  it("clears pending in onSettled so a failed action never freezes a card", () => {
    expect(BOARD).toContain("onSettled: () => setPendingRoomId(null)");
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
    expect(CLIENT).toContain("if (!room) return;");
    expect(CLIENT).toContain("r.roomId === room.roomId ? room : r");
    // No client-side next-condition guess anywhere.
    expect(CLIENT).not.toContain("onMutate");
    expect(CLIENT).not.toMatch(/nextCondition|NEXT_CONDITION|transitionMatrix/);
    expect(BOARD).not.toMatch(/nextCondition|NEXT_CONDITION|transitionMatrix/);
  });

  it("errors never patch a fake state; the board always background-resyncs", () => {
    expect(CLIENT).toContain(
      "onSettled: () => qc.invalidateQueries({ queryKey: HOUSEKEEPING_QUERY_KEY })",
    );
    // setQueryData happens only inside onSuccess.
    const successIdx = CLIENT.indexOf("onSuccess:");
    const patchIdx = CLIENT.indexOf("qc.setQueryData");
    expect(successIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(successIdx);
    expect(CLIENT.match(/qc\.setQueryData/g)!.length).toBe(1);
    expect(CLIENT).not.toContain("onError:");
  });

  it("the server still decides transitions, DND authority and mode role authority", () => {
    expect(BOARD).toContain("room.availableTransitions.map");
    expect(BOARD).toContain("canDnd && room.canSetDnd");
    expect(BOARD).toContain("canDnd && room.canClearDnd");
    expect(BOARD).toContain("board.data!.authority");
    expect(STORE).toContain("assertDndAuthorized");
    expect(ROUTE).toContain("requirePermission");
  });
});
