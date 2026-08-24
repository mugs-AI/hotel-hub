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

/**
 * Run exactly one guarded per-room action.
 *
 * The claim is taken SYNCHRONOUSLY before the mutation is invoked, and the
 * whole invocation uses its own async try/catch/finally, so each overlapping
 * different-room request always produces its own confirmation or error and
 * always releases its own pending id — regardless of settle order.
 *
 * Returns `false` when the call was ignored because the same room already had
 * a request in flight.
 */
export async function runGuardedRoomAction<T>(opts: {
  guard: RoomActionGuard;
  roomId: string;
  invoke: () => Promise<T>;
  onStart?: (roomId: string) => void;
  onSuccess?: (result: T) => void;
  onError?: (error: unknown) => void;
  onSettled?: (roomId: string) => void;
}): Promise<boolean> {
  if (!opts.guard.claim(opts.roomId)) return false;
  opts.onStart?.(opts.roomId);
  try {
    const result = await opts.invoke();
    opts.onSuccess?.(result);
  } catch (error) {
    opts.onError?.(error);
  } finally {
    opts.guard.release(opts.roomId);
    opts.onSettled?.(opts.roomId);
  }
  return true;
}
