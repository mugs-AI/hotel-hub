// Browser client for the WP1 housekeeping vertical. Same-origin only; no
// direct database or N3 access, and no tokens ever touch this module.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useHousekeepingAction() {
  const qc = useQueryClient();
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
    // matrix. The card repaints immediately; the full board resync follows in
    // the background so the user never waits for it.
    onSuccess: (result) => {
      const room = result?.room;
      if (!room) return;
      qc.setQueryData<HousekeepingBoardDTO>(HOUSEKEEPING_QUERY_KEY, (prev) =>
        prev
          ? { ...prev, rooms: prev.rooms.map((r) => (r.roomId === room.roomId ? room : r)) }
          : prev,
      );
    },
    // Background resync in every case: the board carries counts and pending
    // handoffs that a single room cannot fully describe. On error nothing is
    // patched, so no state change is ever faked.
    onSettled: () => qc.invalidateQueries({ queryKey: HOUSEKEEPING_QUERY_KEY }),
  });
}
