// ONE engine, TWO experiences.
//
// This is the single board component. `variant="dedicated"` adds floor filters
// and per-room history; `variant="simple"` is the light front-desk workspace.
// Both read the same server board and the same server-authorised actions, so
// they can never disagree. Every action rendered here comes from the server's
// `availableTransitions` / `canSetDnd` / `canClearDnd` / authority — there is
// no client-side transition matrix.
//
// UX: RECOGNIZE (summary tiles) -> ACT (one prominent next action per room)
// -> CONFIRM (plain-language confirmation). Rooms that need action come first;
// Ready rooms are collapsed behind a filter/counter so they never dominate.
import { useMemo, useRef, useState } from "react";
import { createRoomActionGuard, runGuardedRoomAction } from "@/lib/room-action-guard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";


import {
  CONDITION_LABELS,
  CONDITION_STYLE,
  HK_COLORS,
  OCCUPANCY_LABELS,
  OVERDUE_STAY_LABEL,
  OVERDUE_OCCUPIED_BADGE_LABEL,
  DND_SETUP_HINT,
  DND_CLEANING_HINT,
  DND_SET_LABEL,
  DND_ACTIVE_LABEL,
  DND_CLEAR_LABEL,
  actorDisplayName,
  historyEntryLine,
  TONE_STYLE,
  TRANSITION_LABELS,
  TRANSITION_TONE,
  WORKFLOW_LEGEND,
  blockerLabel,
  confirmationFor,
  type ActionTone,
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

const NAVY = HK_COLORS.navy;
const TEAL = HK_COLORS.teal;
const AMBER = HK_COLORS.amber;
const BLUE = HK_COLORS.blue;
const RED = HK_COLORS.red;
const GRAY = HK_COLORS.gray;
const APPLE_GREEN = HK_COLORS.appleGreen;
const INDIGO = HK_COLORS.indigo;

type Filter =
  | "needs_action"
  | "dirty"
  | "cleaning"
  | "inspected"
  | "ready"
  | "not_set_up"
  | "dnd"
  | "overdue_occupied";

/**
 * Needs attention — the ONE presentation rule shared by both the visible list
 * filter and the summary tally, so the count and the visible list can never
 * disagree.
 *
 * A room needs housekeeping attention when ANY of:
 *  - it is not initialised (condition unknown);
 *  - its housekeeping condition is not `ready`;
 *  - Do Not Disturb is active;
 *  - the server returned a meaningful operational check-in blocker such as
 *    `handoff_pending` (any blocker other than `room_inactive`).
 *
 * `room_inactive` alone is NOT treated as operational for this default
 * housekeeping queue, so an inactive-but-ready room does not become prominent
 * merely for being inactive — unless another blocker/condition also requires
 * action.
 *
 * A Ready + DND or Ready + handoff_pending room may therefore appear in both
 * its specific filter (dnd / ready) and Needs attention. That is intentional.
 */
export function needsHousekeepingAttention(room: HousekeepingRoomDTO): boolean {
  const operationalBlocker = room.checkInBlockers.some((b) => b !== "room_inactive");
  return !room.initialized || room.condition !== "ready" || room.dndActive || operationalBlocker;
}

/**
 * A guest is still physically in the room AND its planned departure date has
 * already passed. Derived only from the authoritative board DTO fields
 * (`occupancy`, `occupancyOverdue`) — never a guess, never a fifth condition,
 * and it never changes what the room IS. Shared by the summary tile, the
 * filter and the card treatment so they can never disagree.
 */
export function isOverdueOccupied(room: HousekeepingRoomDTO): boolean {
  return room.occupancy === "occupied" && room.occupancyOverdue === true;
}

/** Presentation-only grouping. Authority and lifecycle stay on the server. */
function matchesFilter(room: HousekeepingRoomDTO, filter: Filter): boolean {
  switch (filter) {
    case "needs_action":
      return needsHousekeepingAttention(room);
    case "not_set_up":
      return !room.initialized;
    case "dnd":
      return room.dndActive;
    case "overdue_occupied":
      return isOverdueOccupied(room);
    default:
      return room.condition === filter;
  }
}

/**
 * Immutable per-room pending helpers. Overlapping requests must be tracked
 * independently: starting B while A is in flight keeps BOTH pending, and each
 * one is removed only when ITS OWN request settles.
 */
export function addPendingRoom(prev: ReadonlySet<string>, roomId: string): ReadonlySet<string> {
  const next = new Set(prev);
  next.add(roomId);
  return next;
}

export function removePendingRoom(prev: ReadonlySet<string>, roomId: string): ReadonlySet<string> {
  const next = new Set(prev);
  next.delete(roomId);
  return next;
}

/** The primary (filled) action for a condition — the obvious next step. */
const PRIMARY_TRANSITIONS: HousekeepingTransition[] = [
  "start_cleaning",
  "finish_cleaning",
  "mark_ready",
];

export function HousekeepingBoard({ variant }: { variant: "simple" | "dedicated" }) {
  const board = useHousekeepingBoard();
  const act = useHousekeepingAction();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("needs_action");
  const [floorFilter, setFloorFilter] = useState<string>("all");
  const [historyRoomId, setHistoryRoomId] = useState<string | null>(null);
  // Per-room pending, keyed by roomId: acting on one room must never block the
  // rest of the board, and two overlapping requests must settle independently.
  const [pendingRoomIds, setPendingRoomIds] = useState<ReadonlySet<string>>(() => new Set());
  // Synchronous claim set — the authority for "is this room already
  // submitting?", independent of React render timing.
  const guard = useRef(createRoomActionGuard());

  const rooms = board.data?.rooms ?? [];
  const floors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) set.add(r.floor?.trim() || "Unassigned");
    return Array.from(set).sort();
  }, [rooms]);

  const byFloor = useMemo(
    () =>
      floorFilter === "all"
        ? rooms
        : rooms.filter((r) => (r.floor?.trim() || "Unassigned") === floorFilter),
    [rooms, floorFilter],
  );

  const visible = useMemo(() => byFloor.filter((r) => matchesFilter(r, filter)), [byFloor, filter]);

  const tally = useMemo(() => {
    const t = {
      needs_action: 0,
      dirty: 0,
      cleaning: 0,
      inspected: 0,
      ready: 0,
      not_set_up: 0,
      dnd: 0,
      overdue_occupied: 0,
    };
    for (const r of byFloor) {
      if (needsHousekeepingAttention(r)) t.needs_action += 1;
      if (!r.initialized) t.not_set_up += 1;
      if (r.dndActive) t.dnd += 1;
      if (isOverdueOccupied(r)) t.overdue_occupied += 1;
      if (r.condition) t[r.condition] += 1;
    }
    return t;
  }, [byFloor]);

  function run(roomLabel: string, payload: Parameters<typeof act.mutateAsync>[0]) {
    // Deterministic double-submit guard. The claim is SYNCHRONOUS (a ref-held
    // set), so two clicks in the same frame — which would both observe the
    // same rendered `pendingRoomIds` — can never both submit. Overlapping
    // requests on DIFFERENT rooms still run concurrently, and each invocation
    // clears only its own pending id in its own `finally`.
    void runGuardedRoomAction({
      guard: guard.current,
      roomId: payload.roomId,
      invoke: () => act.mutateAsync(payload),
      onStart: (roomId) => {
        setError(null);
        setConfirmation(null);
        setPendingRoomIds((prev) => addPendingRoom(prev, roomId));
      },
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
      onSettled: (roomId) => setPendingRoomIds((prev) => removePendingRoom(prev, roomId)),
    });
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

  // Authority comes from the SERVER, decided by role AND the property's
  // housekeeping mode, so a button can never appear that the server refuses.
  const authority = board.data!.authority;
  const canUpdate = authority.canUpdate;
  const canDnd = authority.canToggleDnd;
  const canInitialize = authority.canInitialize;
  const pendingHandoffs = board.data!.pendingHandoffs;

  return (
    <div className="space-y-4">
      {/* RECOGNIZE — clickable summary tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Tile
          label="Needs attention"
          value={tally.needs_action}
          tone={RED}
          active={filter === "needs_action"}
          onClick={() => setFilter("needs_action")}
        />
        <Tile
          label="Dirty"
          value={tally.dirty}
          tone={AMBER}
          active={filter === "dirty"}
          onClick={() => setFilter("dirty")}
        />
        <Tile
          label="Cleaning"
          value={tally.cleaning}
          tone={TEAL}
          active={filter === "cleaning"}
          onClick={() => setFilter("cleaning")}
        />
        <Tile
          label="Inspected"
          value={tally.inspected}
          tone={BLUE}
          active={filter === "inspected"}
          onClick={() => setFilter("inspected")}
        />
        <Tile
          label="Ready"
          value={tally.ready}
          tone={APPLE_GREEN}
          active={filter === "ready"}
          onClick={() => setFilter("ready")}
        />
        <Tile
          label="Not set up"
          value={tally.not_set_up}
          tone={GRAY}
          active={filter === "not_set_up"}
          onClick={() => setFilter("not_set_up")}
        />
        <Tile
          label="Do Not Disturb"
          value={tally.dnd}
          tone={INDIGO}
          active={filter === "dnd"}
          onClick={() => setFilter("dnd")}
        />
        <Tile
          label="Overdue occupied"
          value={tally.overdue_occupied}
          tone={RED}
          active={filter === "overdue_occupied"}
          onClick={() => setFilter("overdue_occupied")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Property date {board.data!.propertyDate} · {board.data!.timezone}
        </span>
        {filter !== "needs_action" && (
          <button
            type="button"
            onClick={() => setFilter("needs_action")}
            className="underline"
            style={{ color: NAVY }}
          >
            Back to needs attention
          </button>
        )}
      </div>

      {pendingHandoffs > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{pendingHandoffs} room(s) a guest has just left are still being updated.</strong>{" "}
          HotelHub keeps retrying automatically.
        </p>
      )}

      {tally.not_set_up > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{tally.not_set_up} room(s) are not set up for housekeeping.</strong> Check-in is
          blocked for them until someone confirms Ready or Dirty.
          {!canInitialize && " Ask the Owner to set them up."}
        </p>
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

      {floors.length > 1 && (
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

      {/* Dedicated-only: a compact, non-interactive workflow legend so a
          housekeeping team learns the order by sight. Same lifecycle as
          Simple — this is presentation only. */}
      {variant === "dedicated" && (
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-[11px]"
          style={{ borderColor: `${NAVY}1F` }}
          aria-hidden="true"
        >
          <span className="font-medium" style={{ color: GRAY }}>
            Workflow
          </span>
          {WORKFLOW_LEGEND.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 font-semibold"
                style={{ backgroundColor: CONDITION_STYLE[c].bg, color: CONDITION_STYLE[c].fg }}
              >
                {CONDITION_LABELS[c]}
              </span>
              {i < WORKFLOW_LEGEND.length - 1 && <span style={{ color: GRAY }}>→</span>}
            </span>
          ))}
        </div>
      )}

      {rooms.length === 0 && (
        <p className="rounded-md border border-border bg-white p-4 text-sm text-muted-foreground">
          No rooms are mapped yet. Map N3 stock codes to rooms in Rooms &amp; Rates first.
        </p>
      )}

      {rooms.length > 0 && visible.length === 0 && (
        <p className="rounded-md border border-border bg-white p-4 text-sm text-muted-foreground">
          {filter === "needs_action"
            ? "Nothing needs housekeeping attention right now."
            : "No rooms in this view."}
        </p>
      )}

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((room) => (
          <RoomCard
            key={room.roomId}
            room={room}
            variant={variant}
            canUpdate={canUpdate}
            canDnd={canDnd}
            canInitialize={canInitialize}
            busy={pendingRoomIds.has(room.roomId)}
            onTransition={(t) =>
              run(room.roomLabel, { roomId: room.roomId, action: "transition", transition: t })
            }
            onDnd={(active) => run(room.roomLabel, { roomId: room.roomId, action: "dnd", active })}
            onInitialize={(condition) =>
              run(room.roomLabel, { roomId: room.roomId, action: "initialize", condition })
            }
            onHistory={() => setHistoryRoomId(room.roomId)}
          />
        ))}
      </ul>

      {/* Ready is de-emphasised: a compact counter, never the default list. */}
      {filter !== "ready" && tally.ready > 0 && (
        <p className="text-sm text-muted-foreground">
          {tally.ready} room(s) are Ready — housekeeping complete.{" "}
          <button
            type="button"
            onClick={() => setFilter("ready")}
            className="underline"
            style={{ color: NAVY }}
          >
            Show Ready rooms
          </button>
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

function Tile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-lg border p-3 text-left transition-colors"
      style={{
        borderColor: active ? tone : "#D6E0EA",
        backgroundColor: active ? `${tone}12` : "white",
        boxShadow: active ? `inset 0 -3px 0 ${tone}` : undefined,
      }}
    >
      <span className="block text-2xl font-semibold leading-none" style={{ color: tone }}>
        {value}
      </span>
      <span className="mt-1 block text-xs font-medium" style={{ color: NAVY }}>
        {label}
      </span>
    </button>
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

/**
 * One room card. Exported so its RENDERED output (visible text and buttons)
 * can be asserted directly in tests, rather than trusting a source constant.
 */
export function RoomCard({
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
  const style = room.condition ? CONDITION_STYLE[room.condition] : { bg: "#EEF2F6", fg: GRAY };
  const overdueOccupied = isOverdueOccupied(room);
  // DND is an occupied-room overlay, never a condition. It is deliberately
  // unavailable while the room is being cleaned — the card says so instead of
  // silently hiding the control.
  const dndBlockedByCleaning =
    room.initialized && room.condition === "cleaning" && room.occupancy === "occupied";

  // Corrective alternatives (mark dirty / send back to cleaning) are always
  // the QUIET choice; the one obvious next step stays dominant. This applies
  // in both experiences, but matters most in Simple where a front-desk staff
  // member should never have to pick between two equally loud buttons.
  const primaryTransitions = room.availableTransitions.filter((t) =>
    PRIMARY_TRANSITIONS.includes(t),
  );
  const secondaryTransitions = room.availableTransitions.filter(
    (t) => !PRIMARY_TRANSITIONS.includes(t),
  );

  return (
    <li
      className="rounded-lg border p-3 shadow-sm"
      style={
        overdueOccupied
          ? {
              borderColor: `${RED}55`,
              borderLeft: `4px solid ${RED}`,
              backgroundColor: HK_COLORS.redSoft,
            }
          : { borderColor: "#E2E8F0", backgroundColor: "white" }
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold" style={{ color: NAVY }}>
            {room.roomLabel}
          </div>
          <div className="text-xs text-muted-foreground">
            {room.floor?.trim() || "Unassigned floor"} · {OCCUPANCY_LABELS[room.occupancy]}
            {room.occupancyOverdue && !overdueOccupied ? ` · ${OVERDUE_STAY_LABEL}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: style.bg, color: style.fg }}
          >
            {busy ? "Updating…" : room.condition ? CONDITION_LABELS[room.condition] : "Not set up"}
          </span>
          {room.dndActive && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: HK_COLORS.indigo, color: "#FFFFFF" }}
            >
              {DND_ACTIVE_LABEL}
            </span>
          )}
        </div>
      </div>

      {overdueOccupied && (
        <p
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: RED, color: "#FFFFFF" }}
        >
          {OVERDUE_OCCUPIED_BADGE_LABEL}
        </p>
      )}

      {room.dndActive && (
        <p
          className="mt-2 rounded-md px-2 py-1 text-[11px] font-medium"
          style={{ backgroundColor: HK_COLORS.indigoSoft, color: HK_COLORS.indigoInk }}
        >
          Do Not Disturb — cleaning paused.
        </p>
      )}

      {room.checkInBlockers.length > 0 && room.occupancy === "arriving" && (
        <p className="mt-2 rounded-md bg-[#FDECEC] px-2 py-1 text-[11px] font-medium text-[#9B1C1C]">
          Arrival today is blocked: {blockerLabel(room.checkInBlockers[0]!)}
        </p>
      )}

      <p className="mt-2 text-xs" style={{ color: NAVY }}>
        Next: {room.nextStep}
      </p>

      {!room.initialized && (
        <div className="mt-3">
          {canInitialize ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton tone="positive" busy={busy} onClick={() => onInitialize("ready")}>
                Set up as Ready
              </ActionButton>
              <ActionButton tone="corrective" busy={busy} onClick={() => onInitialize("dirty")}>
                Set up as Dirty
              </ActionButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the Owner can set this room up for housekeeping.
            </p>
          )}
          {/* An occupied room that has never been set up still shows the Do
              Not Disturb control — disabled, but unmistakably present, with
              the exact first step written out. */}
          {room.occupancy === "occupied" && canDnd && (
            <div className="mt-3 border-t border-dashed pt-2" style={{ borderColor: "#E2E8F0" }}>
              <ActionButton tone="dnd" busy={false} disabled onClick={() => {}}>
                {DND_SET_LABEL}
              </ActionButton>
              <p className="mt-1 text-[11px] text-muted-foreground">{DND_SETUP_HINT}</p>
            </div>
          )}
        </div>
      )}

      {room.initialized && (
        <div className="mt-3 space-y-2">
          {/* The ONE dominant next action, straight from the server's
              availableTransitions — never a client-invented shortcut. */}
          {canUpdate && primaryTransitions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {primaryTransitions.map((t) => (
                <ActionButton
                  key={t}
                  busy={busy}
                  tone={TRANSITION_TONE[t]}
                  primary
                  onClick={() => onTransition(t)}
                >
                  {TRANSITION_LABELS[t]}
                </ActionButton>
              ))}
              {canDnd && room.canClearDnd && (
                <ActionButton tone="positive" busy={busy} primary onClick={() => onDnd(false)}>
                  Clear Do Not Disturb
                </ActionButton>
              )}
            </div>
          )}

          {/* Corrective alternatives — always quieter, grouped on their own
              row so they never compete with the dominant next action. */}
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate &&
              secondaryTransitions.map((t) => (
                <ActionButton
                  key={t}
                  busy={busy}
                  tone={TRANSITION_TONE[t]}
                  onClick={() => onTransition(t)}
                >
                  {TRANSITION_LABELS[t]}
                </ActionButton>
              ))}
            {canDnd && room.canSetDnd && (
              <ActionButton tone="dnd" busy={busy} onClick={() => onDnd(true)}>
                {DND_SET_LABEL}
              </ActionButton>
            )}
            {/* Mid-clean: DND stays visible but unavailable, and says why. */}
            {canDnd && !room.canSetDnd && !room.dndActive && dndBlockedByCleaning && (
              <ActionButton tone="dnd" busy={false} disabled onClick={() => {}}>
                {DND_SET_LABEL}
              </ActionButton>
            )}
            {canUpdate && primaryTransitions.length === 0 && canDnd && room.canClearDnd && (
              <ActionButton tone="dndClear" busy={busy} primary onClick={() => onDnd(false)}>
                {DND_CLEAR_LABEL}
              </ActionButton>
            )}
          </div>

          {canDnd && dndBlockedByCleaning && !room.dndActive && (
            <p className="text-[11px] text-muted-foreground">{DND_CLEANING_HINT}</p>
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
    </li>
  );
}

/**
 * Semantic action button. Colour carries meaning (green positive, amber
 * corrective, teal work, blue inspection, indigo DND) but the LABEL always
 * states the action too, so colour is never the only signal. Which actions
 * exist is decided by the server; only their styling lives here.
 */
function ActionButton({
  children,
  onClick,
  busy,
  primary,
  disabled,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  /** Visible but not actionable yet (e.g. DND before initialization). */
  disabled?: boolean;
  tone?: ActionTone;
}) {
  const t = TONE_STYLE[tone];
  return (
    <button
      type="button"
      disabled={busy || disabled === true}
      aria-busy={busy}
      onClick={onClick}
      className={
        primary
          ? "rounded-md border px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          : "rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
      }
      style={{ borderColor: t.border, backgroundColor: t.bg, color: t.fg }}
    >
      {busy ? "Updating…" : children}
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
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle style={{ color: NAVY }}>Housekeeping history — {roomLabel}</SheetTitle>
        </SheetHeader>
        {history.isLoading && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {history.data && history.data.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            No housekeeping activity recorded yet.
          </p>
        )}
        <ol className="mt-4 space-y-3 border-l pl-4" style={{ borderColor: "#E2E8F0" }}>
          {(history.data ?? []).map((e, i) => (
            <li key={i} className="relative text-xs">
              <span
                className="absolute -left-[21px] top-1 h-2 w-2 rounded-full"
                style={{ backgroundColor: HK_COLORS.teal }}
                aria-hidden
              />
              <p className="font-medium" style={{ color: NAVY }}>
                {historyEntryLine(e)}
              </p>
              <p className="text-muted-foreground">
                {actorDisplayName(e.actorLabel)} · {new Date(e.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
