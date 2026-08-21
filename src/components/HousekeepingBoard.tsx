// ONE engine, TWO experiences.
//
// This is the single board component. `variant="dedicated"` is the full
// housekeeping workspace; `variant="simple"` is the compact Front Desk strip
// that answers only "which rooms can I sell right now, and what is blocking
// the rest". Both read the same server board and the same allowed actions,
// so they can never disagree.
import { useMemo, useState } from "react";
import {
  BOARD_GROUP_LABELS,
  CONDITION_HELP,
  CONDITION_LABELS,
  CONDITION_STYLE,
  OCCUPANCY_LABELS,
  TRANSITION_LABELS,
  blockerLabel,
  confirmationFor,
  type BoardGroup,
  type BootstrapCondition,
  type HousekeepingTransition,
} from "@/lib/housekeeping";
import {
  housekeepingMessage,
  useHousekeepingAction,
  useHousekeepingBoard,
  useRoomHistory,
} from "@/lib/housekeeping-client";
import type { HousekeepingRoomDTO } from "@/lib/housekeeping-store.server";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";

const GROUP_ORDER: BoardGroup[] = ["needs_attention", "in_progress", "not_set_up", "ready"];

export function HousekeepingBoard({ variant }: { variant: "simple" | "dedicated" }) {
  const board = useHousekeepingBoard();
  const act = useHousekeepingAction();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [floorFilter, setFloorFilter] = useState<string>("all");
  const [historyRoomId, setHistoryRoomId] = useState<string | null>(null);

  const rooms = board.data?.rooms ?? [];
  const floors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) set.add(r.floor?.trim() || "Unassigned");
    return Array.from(set).sort();
  }, [rooms]);

  const visible = useMemo(
    () =>
      floorFilter === "all"
        ? rooms
        : rooms.filter((r) => (r.floor?.trim() || "Unassigned") === floorFilter),
    [rooms, floorFilter],
  );

  const grouped = useMemo(() => {
    const map = new Map<BoardGroup, HousekeepingRoomDTO[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const r of visible) map.get(r.group)!.push(r);
    return map;
  }, [visible]);

  function run(roomId: string, roomLabel: string, payload: Parameters<typeof act.mutate>[0]) {
    setError(null);
    setConfirmation(null);
    act.mutate(payload, {
      onSuccess: (result) => {
        if (payload.action === "transition") {
          const to = (result as { condition?: string }).condition;
          setConfirmation(
            to
              ? confirmationFor(roomLabel, payload.transition, to as keyof typeof CONDITION_LABELS)
              : `${roomLabel} updated.`,
          );
        } else if (payload.action === "dnd") {
          setConfirmation(
            payload.active
              ? `Do Not Disturb is on for ${roomLabel}. Cleaning is paused.`
              : `Do Not Disturb cleared for ${roomLabel}.`,
          );
        } else {
          setConfirmation(`${roomLabel} is now tracked by housekeeping.`);
        }
      },
      onError: (err) => setError(housekeepingMessage((err as Error).message)),
    });
    void roomId;
  }

  if (board.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading room conditions…</p>;
  }
  if (board.isError) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {housekeepingMessage((board.error as Error).message)}
      </p>
    );
  }

  const counts = board.data!.counts;
  // Authority comes from the SERVER, decided by role AND the property's
  // housekeeping mode, so a button can never appear that the server refuses.
  const authority = board.data!.authority;
  const canUpdate = authority.canUpdate;
  const canDnd = authority.canToggleDnd;
  const canInitialize = authority.canInitialize;
  const pendingHandoffs = board.data!.pendingHandoffs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stat label="Needs attention" value={counts.needs_attention} tone="#9B1C1C" />
        <Stat label="In progress" value={counts.in_progress} tone="#8A6100" />
        <Stat label="Ready to sell" value={counts.ready} tone="#0B6B5C" />
        {pendingHandoffs > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>
              {pendingHandoffs} room(s) a guest has just left are still being updated.
            </strong>{" "}
            HotelHub keeps retrying automatically — refresh in a moment to see them as Dirty.
          </div>
        )}

        {counts.uninitialized > 0 && (
          <Stat label="Not set up" value={counts.uninitialized} tone={NAVY} />
        )}
        {counts.dnd > 0 && <Stat label="Do Not Disturb" value={counts.dnd} tone="#1B4F86" />}
        <span className="ml-auto text-xs text-muted-foreground">
          Property date {board.data!.propertyDate} · {board.data!.timezone}
        </span>
      </div>

      {counts.uninitialized > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{counts.uninitialized} room(s) are not set up for housekeeping.</strong> Their
          condition is unknown, so check-in is blocked for them until someone confirms whether they
          are Ready or Dirty.
          {!canInitialize && " Ask the Owner to set them up in Rooms &amp; Rates."}
        </div>
      )}

      {confirmation && (
        <p
          role="status"
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: TEAL, backgroundColor: "#E3F6F1", color: "#0B6B5C" }}
        >
          {confirmation}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {variant === "dedicated" && floors.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Floor</span>
          <FloorChip active={floorFilter === "all"} onClick={() => setFloorFilter("all")}>
            All
          </FloorChip>
          {floors.map((f) => (
            <FloorChip key={f} active={floorFilter === f} onClick={() => setFloorFilter(f)}>
              {f}
            </FloorChip>
          ))}
        </div>
      )}

      {rooms.length === 0 && (
        <p className="rounded-md border border-border bg-white p-4 text-sm text-muted-foreground">
          No rooms are mapped yet. Map N3 stock codes to rooms in Rooms &amp; Rates first.
        </p>
      )}

      {GROUP_ORDER.map((group) => {
        const list = grouped.get(group) ?? [];
        if (list.length === 0) return null;
        if (variant === "simple" && group === "ready") return null;
        return (
          <section key={group} className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: NAVY }}>
              {BOARD_GROUP_LABELS[group]}{" "}
              <span className="font-normal text-muted-foreground">({list.length})</span>
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((room) => (
                <RoomCard
                  key={room.roomId}
                  room={room}
                  variant={variant}
                  canUpdate={canUpdate}
                  canDnd={canDnd}
                  canInitialize={canInitialize}
                  busy={act.isPending}
                  onTransition={(t) =>
                    run(room.roomId, room.roomLabel, {
                      roomId: room.roomId,
                      action: "transition",
                      transition: t,
                    })
                  }
                  onDnd={(active) =>
                    run(room.roomId, room.roomLabel, {
                      roomId: room.roomId,
                      action: "dnd",
                      active,
                    })
                  }
                  onInitialize={(condition) =>
                    run(room.roomId, room.roomLabel, {
                      roomId: room.roomId,
                      action: "initialize",
                      condition,
                    })
                  }
                  onHistory={
                    variant === "dedicated" ? () => setHistoryRoomId(room.roomId) : undefined
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}

      {variant === "simple" && (grouped.get("ready") ?? []).length > 0 && (
        <p className="text-sm text-muted-foreground">
          {(grouped.get("ready") ?? []).length} room(s) are Ready to sell.
        </p>
      )}

      {historyRoomId && (
        <RoomHistory
          roomId={historyRoomId}
          roomLabel={rooms.find((r) => r.roomId === historyRoomId)?.roomLabel ?? ""}
          onClose={() => setHistoryRoomId(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span
      className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium"
      style={{ color: tone }}
    >
      {label}: <strong className="text-sm">{value}</strong>
    </span>
  );
}

function FloorChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      style={{
        borderColor: active ? TEAL : "#D6E0EA",
        backgroundColor: active ? TEAL : "white",
        color: active ? "white" : NAVY,
      }}
    >
      {children}
    </button>
  );
}

function RoomCard({
  room,
  variant,
  canUpdate,
  canDnd,
  canInitialize,
  busy,
  onTransition,
  onDnd,
  onInitialize,
  onHistory,
}: {
  room: HousekeepingRoomDTO;
  variant: "simple" | "dedicated";
  canUpdate: boolean;
  canDnd: boolean;
  canInitialize: boolean;
  busy: boolean;
  onTransition: (t: HousekeepingTransition) => void;
  onDnd: (active: boolean) => void;
  onInitialize: (c: BootstrapCondition) => void;
  onHistory?: () => void;
}) {
  const style = room.condition ? CONDITION_STYLE[room.condition] : { bg: "#EEF2F6", fg: NAVY };
  return (
    <li className="rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: NAVY }}>
            {room.roomLabel}
          </div>
          <div className="text-xs text-muted-foreground">
            {room.floor?.trim() || "Unassigned floor"} · {OCCUPANCY_LABELS[room.occupancy]}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: style.bg, color: style.fg }}
        >
          {room.condition ? CONDITION_LABELS[room.condition] : "Not set up"}
        </span>
      </div>

      {room.dndActive && (
        <p className="mt-2 rounded-md bg-[#E7F1FB] px-2 py-1 text-[11px] font-medium text-[#1B4F86]">
          Do Not Disturb — cleaning is paused at the guest&apos;s request.
        </p>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        {room.condition ? CONDITION_HELP[room.condition] : room.nextStep}
      </p>

      {variant === "dedicated" && room.condition && (
        <p className="mt-1 text-xs font-medium" style={{ color: NAVY }}>
          Next: {room.nextStep}
        </p>
      )}

      {!room.initialized && (
        <div className="mt-3">
          {canInitialize ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton busy={busy} primary onClick={() => onInitialize("ready")}>
                Set up as Ready
              </ActionButton>
              <ActionButton busy={busy} onClick={() => onInitialize("dirty")}>
                Set up as Dirty
              </ActionButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the Owner can set this room up for housekeeping.
            </p>
          )}
        </div>
      )}

      {room.initialized && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canUpdate &&
            room.availableTransitions.map((t) => (
              <ActionButton
                key={t}
                busy={busy}
                primary={t === "mark_ready" || t === "start_cleaning"}
                onClick={() => onTransition(t)}
              >
                {TRANSITION_LABELS[t]}
              </ActionButton>
            ))}
          {canDnd && room.canSetDnd && (
            <ActionButton busy={busy} onClick={() => onDnd(true)}>
              Set Do Not Disturb
            </ActionButton>
          )}
          {canDnd && room.canClearDnd && (
            <ActionButton busy={busy} primary onClick={() => onDnd(false)}>
              Clear Do Not Disturb
            </ActionButton>
          )}
          {onHistory && (
            <button
              type="button"
              onClick={onHistory}
              className="rounded-md px-2 py-1 text-xs underline"
              style={{ color: NAVY }}
            >
              History
            </button>
          )}
        </div>
      )}

      {room.checkInBlockers.length > 0 && room.occupancy === "arriving" && (
        <p className="mt-2 rounded-md bg-[#FDECEC] px-2 py-1 text-[11px] font-medium text-[#9B1C1C]">
          Arrival today is blocked: {blockerLabel(room.checkInBlockers[0]!)}
        </p>
      )}
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      style={{
        borderColor: primary ? TEAL : "#D6E0EA",
        backgroundColor: primary ? TEAL : "white",
        color: primary ? "white" : NAVY,
      }}
    >
      {children}
    </button>
  );
}

function RoomHistory({
  roomId,
  roomLabel,
  onClose,
}: {
  roomId: string;
  roomLabel: string;
  onClose: () => void;
}) {
  const history = useRoomHistory(roomId);
  return (
    <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: NAVY }}>
          Housekeeping history — {roomLabel}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs underline"
          style={{ color: NAVY }}
        >
          Close
        </button>
      </div>
      {history.isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
      {history.data && history.data.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No housekeeping activity recorded yet.</p>
      )}
      <ul className="mt-2 space-y-1">
        {(history.data ?? []).map((e, i) => (
          <li key={i} className="text-xs text-muted-foreground">
            <span className="font-medium" style={{ color: NAVY }}>
              {e.action.replace(/_/g, " ")}
            </span>
            {e.previousCondition && e.resultingCondition
              ? ` · ${e.previousCondition} → ${e.resultingCondition}`
              : ""}
            {e.actorLabel ? ` · ${e.actorLabel}` : ""} · {new Date(e.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
