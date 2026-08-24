// Synchronous, render-independent double-submit guard for per-room actions.
//
// React state is not a safe guard for rapid clicks: two events fired in the
// same frame both observe the SAME rendered `pendingRoomIds`, so both pass a
// state-based check. This guard is a mutable Set held in a ref, claimed and
// released synchronously, so:
//  - the same room can never submit twice while its request is in flight;
//  - different rooms always overlap freely;
//  - each invocation releases only ITS OWN id, even when requests settle out
//    of order.
export type RoomActionGuard = {
  /** Returns true when THIS call took the lock for `roomId`. */
  claim: (roomId: string) => boolean;
  release: (roomId: string) => void;
  has: (roomId: string) => boolean;
  size: () => number;
};

export function createRoomActionGuard(): RoomActionGuard {
  const claimed = new Set<string>();
  return {
    claim(roomId) {
      if (claimed.has(roomId)) return false;
      claimed.add(roomId);
      return true;
    },
    release(roomId) {
      claimed.delete(roomId);
    },
    has(roomId) {
      return claimed.has(roomId);
    },
    size() {
      return claimed.size;
    },
  };
}
