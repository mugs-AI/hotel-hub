// Browser client for the WP1 housekeeping vertical. Same-origin only; no
// direct database or N3 access, and no tokens ever touch this module.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  HousekeepingBoardDTO,
  HousekeepingEventDTO,
  HousekeepingRoomDTO,
} from "@/lib/housekeeping-store.server";

import type { BootstrapCondition, HousekeepingTransition } from "@/lib/housekeeping";

export const HOUSEKEEPING_QUERY_KEY = ["housekeeping", "board"] as const;

/** Plain-language messages. Never surface a raw server code to staff. */
export const HOUSEKEEPING_ERROR_MESSAGES: Record<string, string> = {
  housekeeping_not_initialized: "Housekeeping has not been set up for this room yet.",
  dnd_active: "Do Not Disturb is on. Clear it before changing this room.",
  illegal_transition: "This room already moved on — refresh to see its current state.",
  room_not_occupied: "Do Not Disturb only applies to a room a guest is staying in.",
  cleaning_in_progress: "Cleaning is in progress. Finish or stop it before setting Do Not Disturb.",
  room_not_found: "That room no longer exists.",
  invalid_condition: "Choose either Ready or Dirty.",
  forbidden: "Your role cannot perform this action.",
  not_permitted_in_mode:
    "This property's housekeeping workflow does not allow your role to do that.",
  role_unassigned: "Your role cannot perform this action.",
  unauthenticated: "Your session expired. Reopen HotelHub from N3.",
};

export function housekeepingMessage(code: string): string {
  return HOUSEKEEPING_ERROR_MESSAGES[code] ?? "That action could not be completed.";
}

async function readError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `request_failed_${res.status}`);
}

export function useHousekeepingBoard(enabled = true) {
  return useQuery({
    queryKey: HOUSEKEEPING_QUERY_KEY,
    enabled,
    queryFn: async (): Promise<HousekeepingBoardDTO> => {
      const res = await fetch("/api/hotel/housekeeping", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return readError(res);
      return (await res.json()) as HousekeepingBoardDTO;
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useRoomHistory(roomId: string | null) {
  return useQuery({
    queryKey: ["housekeeping", "history", roomId],
    enabled: Boolean(roomId),
    queryFn: async (): Promise<HousekeepingEventDTO[]> => {
      const res = await fetch(`/api/hotel/housekeeping/rooms/${roomId}`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return readError(res);
      const body = (await res.json()) as { events: HousekeepingEventDTO[] };
      return body.events;
    },
  });
}

export type HousekeepingAction =
  | { action: "initialize"; condition: BootstrapCondition }
  | { action: "transition"; transition: HousekeepingTransition; note?: string | null }
  | { action: "dnd"; active: boolean };

/**
 * Deterministically recompute the board's display counts from the
 * AUTHORITATIVE cached room list. Never a guessed delta: after one room is
 * replaced by the server's own DTO, the tallies are derived again from every
 * room, so a count can never drift away from what the board shows.
 */
export function recomputeBoardCounts(
  rooms: readonly HousekeepingRoomDTO[],
): HousekeepingBoardDTO["counts"] {
  const counts = {
    needs_attention: 0,
    in_progress: 0,
    ready: 0,
    not_set_up: 0,
    dnd: 0,
    uninitialized: 0,
  } as HousekeepingBoardDTO["counts"];
  for (const r of rooms) {
    counts[r.group] += 1;
    if (r.dndActive) counts.dnd += 1;
    if (!r.initialized) counts.uninitialized += 1;
  }
  return counts;
}

/** Replace exactly one room in a cached board and re-derive the counts. */
export function patchBoardWithRoom(
  board: HousekeepingBoardDTO,
  room: HousekeepingRoomDTO,
): HousekeepingBoardDTO {
  const rooms = board.rooms.map((r) => (r.roomId === room.roomId ? room : r));
  return { ...board, rooms, counts: recomputeBoardCounts(rooms) };
}

/**
 * P1 mode-change correction: a saved housekeeping workflow must be visible on
 * the very next entry to /housekeeping, without a hard reload and without
 * waiting for `staleTime`. Removing the exact board cache entry forces the
 * next mount to perform an authoritative GET; the server response — not this
 * client — remains the source of mode, authority and actions.
 */
export function resetHousekeepingBoardCache(qc: QueryClient): void {
  qc.removeQueries({ queryKey: HOUSEKEEPING_QUERY_KEY, exact: true });
  void qc.invalidateQueries({ queryKey: ["housekeeping"] });
}

/** Background resync delay: long enough for the patched card to repaint. */
export const BOARD_RESYNC_DELAY_MS = 1500;

export function useHousekeepingAction() {
  const qc = useQueryClient();
  const resync = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resync.current) clearTimeout(resync.current);
    },
    [],
  );

  return useMutation({
    mutationFn: async (input: { roomId: string } & HousekeepingAction) => {
      const { roomId, ...body } = input;
      const res = await fetch(`/api/hotel/housekeeping/rooms/${roomId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return readError(res);
      return (await res.json()) as { room?: HousekeepingRoomDTO } & Record<string, unknown>;
    },
    // Patch ONLY the room the server just told us about, from the server's own
    // authoritative DTO — no optimistic guess, no client-side transition
    // matrix. The card repaints immediately and the counts are re-derived from
    // the authoritative cached list.
    onSuccess: (result) => {
      const room = result?.room;
      if (!room) {
        // No authoritative room DTO: refetch immediately rather than show a
        // card the server never confirmed.
        void qc.invalidateQueries({ queryKey: HOUSEKEEPING_QUERY_KEY });
        return;
      }
      qc.setQueryData<HousekeepingBoardDTO>(HOUSEKEEPING_QUERY_KEY, (prev) =>
        prev ? patchBoardWithRoom(prev, room) : prev,
      );
      // Do NOT race a competing full-board fetch against the repaint. The
      // board still carries pending handoffs and cross-room state, so an
      // authoritative resync is SCHEDULED (and debounced across rapid
      // actions) once the card has already repainted.
      if (resync.current) clearTimeout(resync.current);
      resync.current = setTimeout(() => {
        resync.current = null;
        void qc.invalidateQueries({ queryKey: HOUSEKEEPING_QUERY_KEY });
      }, BOARD_RESYNC_DELAY_MS);
    },
    // A failed action changes nothing locally; resync immediately so the board
    // reflects authoritative server state.
    onError: () => {
      void qc.invalidateQueries({ queryKey: HOUSEKEEPING_QUERY_KEY });
    },
  });
}
