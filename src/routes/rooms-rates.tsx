import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { HousekeepingBoard } from "@/components/HousekeepingBoard";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { buildMappedStockSet } from "@/lib/room-picker";
import { N3Picker } from "@/components/N3Picker";

const MAX_GUESTS_TOOLTIP = "Maximum number of guests allowed to stay in this room.";

export const Route = createFileRoute("/rooms-rates")({
  head: () => ({
    meta: [
      { title: "Rooms & Rates — HotelHub" },
      {
        name: "description",
        content: "Configure N3 walk-in customer and map rooms to N3 stock codes.",
      },
    ],
  }),
  component: RoomsRatesPage,
});

type Settings = {
  tenantId: string;
  currency: string;
  timezone: string;
  standardCheckInTime: string;
  standardCheckOutTime: string;
  walkInCustomer: { n3Id: string; n3Code: string; n3Name: string | null } | null;
};

type Room = {
  id: string;
  n3StockId: string;
  n3StockCode: string;
  n3StockName: string | null;
  roomNumber: string;
  displayName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  isActive: boolean;
};

type CustomerRow = { id: string; code: string; name: string | null };
type StockRow = { id: string; code: string; name: string | null; isActive: boolean | null };

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body;
}

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

const CARD = "rounded-lg bg-white p-5 shadow-sm border";

function RoomsRatesPage() {
  const session = useSessionMe();
  const authed = session.data && session.data.authenticated === true ? session.data : null;
  const canView = authed ? hasPermission(authed.role, "hotel:rooms:view") : false;
  const canSetup = authed ? hasPermission(authed.role, "hotel:setup") : false;

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <section
          className="rounded-lg p-6 text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})` }}
        >
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            Hotel Setup
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Rooms &amp; Rates</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/85">
            Configure the default N3 walk-in customer and map N3 stock codes to hotel rooms. Base
            rates are maintained locally in HotelHub (MYR).
          </p>
        </section>
        {!authed ? null : !canView ? (
          <NoAccess />
        ) : (
          <>
            {authed.role && hasPermission(authed.role, "hotel:housekeeping:view") && (
              <section className={CARD} style={{ borderColor: `${NAVY}1F` }}>
                <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
                  Room readiness
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  The rooms that still need housekeeping work. Ready means housekeeping is complete
                  — booking and allocation rules still apply. Ready rooms are counted but not listed
                  — the full board lives under Housekeeping.
                </p>
                <div className="mt-4">
                  <HousekeepingBoard variant="simple" />
                </div>
              </section>
            )}
            <RoomsRatesInner canSetup={canSetup} onN3Unauthorized={() => session.refetch()} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <div
      className="rounded-md p-4 text-sm"
      style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}1A`, borderWidth: 1 }}
    >
      <p className="font-semibold" style={{ color: ERR }}>
        Access denied
      </p>
      <p className="mt-1 text-muted-foreground">
        Rooms &amp; Rates is restricted to Owner and Front Desk roles.
      </p>
    </div>
  );
}

function RoomsRatesInner({
  canSetup,
  onN3Unauthorized,
}: {
  canSetup: boolean;
  onN3Unauthorized: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        j<{ settings: Settings }>("/api/hotel/settings"),
        j<{ rooms: Room[] }>("/api/hotel/rooms"),
      ]);
      setSettings(s.settings);
      setRooms(r.rooms);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeRoomCount = useMemo(() => rooms.filter((r) => r.isActive).length, [rooms]);
  const ready = Boolean(settings?.walkInCustomer && activeRoomCount > 0);

  return (
    <div className="space-y-6">
      <ReadinessCard
        ready={ready}
        hasCustomer={!!settings?.walkInCustomer}
        activeRoomCount={activeRoomCount}
      />
      {error ? (
        <div
          className="rounded-md p-3 text-sm"
          style={{ borderColor: ERR, color: ERR, borderWidth: 1, backgroundColor: `${ERR}0F` }}
        >
          {error}
        </div>
      ) : null}
      <PropertySettingsPointer />
      <RoomsCard
        rooms={rooms}
        canSetup={canSetup}
        onChange={refresh}
        onN3Unauthorized={onN3Unauthorized}
      />
    </div>
  );
}

function ReadinessCard({
  ready,
  hasCustomer,
  activeRoomCount,
}: {
  ready: boolean;
  hasCustomer: boolean;
  activeRoomCount: number;
}) {
  const color = ready ? TEAL : GOLD;
  return (
    <div
      className={CARD}
      style={{
        borderColor: `${color}66`,
        backgroundColor: `${color}12`,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: NAVY }}>
            Hotel setup readiness
          </p>
          <p className="mt-1 text-sm font-medium" style={{ color }}>
            {ready ? "✓ Ready for Reservations" : "Setup incomplete"}
          </p>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>{hasCustomer ? "✓" : "•"} Default walk-in customer selected</li>
          <li>{activeRoomCount > 0 ? "✓" : "•"} At least one active room mapped</li>
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({ label, accent, tag }: { label: string; accent: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-6 w-1.5 rounded"
        style={{ backgroundColor: accent }}
      />
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        {label}
      </h2>
      <span
        className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: `${accent}22`, color: accent }}
      >
        {tag}
      </span>
    </div>
  );
}

function PropertySettingsPointer() {
  return (
    <div className={CARD} style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}>
      <SectionHeader label="Property settings" accent={NAVY} tag="Moved" />
      <p className="mt-2 text-xs text-muted-foreground">
        Currency, timezone, standard check-in / check-out times, guest-editing controls and the
        default N3 walk-in customer now live in the Settings workspace.
      </p>
      <Link
        to="/settings"
        className="mt-3 inline-flex rounded-md px-3 py-1.5 text-xs font-medium text-white"
        style={{ backgroundColor: NAVY }}
      >
        Open Settings
      </Link>
    </div>
  );
}

function RoomsCard({
  rooms,
  canSetup,
  onChange,
  onN3Unauthorized,
}: {
  rooms: Room[];
  canSetup: boolean;
  onChange: () => void;
  onN3Unauthorized: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className={CARD} style={{ borderColor: `${TEAL}33`, borderLeft: `4px solid ${TEAL}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionHeader label="Rooms" accent={TEAL} tag="Inventory" />
          <p className="mt-1 text-xs text-muted-foreground">
            Room number equals the verified N3 stock code. Different rooms may carry different local
            base rates.
          </p>
        </div>
        {canSetup ? (
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
            style={{ backgroundColor: TEAL }}
          >
            {adding ? "Cancel" : "Add room"}
          </button>
        ) : null}
      </div>
      {adding && canSetup ? (
        <div
          className="mt-4 rounded-md p-3"
          style={{
            backgroundColor: `${TEAL}0D`,
            borderLeft: `3px solid ${TEAL}`,
            border: `1px dashed ${TEAL}55`,
          }}
        >
          <p className="text-xs font-semibold" style={{ color: NAVY }}>
            Pick an N3 stock code — it becomes the room number automatically.
          </p>
          <N3Picker
            kind="stocks"
            disabledCodes={buildMappedStockSet(rooms)}
            onPick={async (row) => {
              try {
                await j("/api/hotel/rooms", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ code: row.code }),
                });
                setAdding(false);
                onChange();
              } catch (e) {
                if ((e as Error).message === "n3_unauthorized") onN3Unauthorized();
                alert((e as Error).message);
              }
            }}
          />
        </div>
      ) : null}
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
              <th className="py-2 pr-4">Room #</th>
              <th className="py-2 pr-4">Display name</th>
              <th className="py-2 pr-4">Stock name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Floor</th>
              <th className="py-2 pr-4" title={MAX_GUESTS_TOOLTIP}>
                Max guests
              </th>
              <th className="py-2 pr-4">Base rate</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4 text-center text-muted-foreground">
                  No rooms mapped yet.
                </td>
              </tr>
            ) : null}
            {rooms.map((r, i) => (
              <RoomRow
                key={r.id}
                room={r}
                zebra={i % 2 === 1}
                canSetup={canSetup}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoomRow({
  room,
  zebra,
  canSetup,
  onChange,
}: {
  room: Room;
  zebra: boolean;
  canSetup: boolean;
  onChange: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState(room.roomType);
  const [floor, setFloor] = useState(room.floor ?? "");
  const [occ, setOcc] = useState(String(room.maxOccupancy));
  const [rate, setRate] = useState(String(room.baseRate));
  const [active, setActive] = useState(room.isActive);
  const [displayName, setDisplayName] = useState(room.displayName ?? "");

  async function save() {
    const trimmed = displayName.trim();
    if (trimmed.length > 80) {
      alert("Display name must be 80 characters or fewer.");
      return;
    }
    try {
      await j(`/api/hotel/rooms/${encodeURIComponent(room.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomType: type,
          floor,
          maxOccupancy: Number(occ),
          baseRate: Number(rate),
          isActive: active,
          displayName: trimmed.length === 0 ? null : trimmed,
        }),
      });
      setEdit(false);
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function remove() {
    if (!confirm(`Remove room ${room.roomNumber}?`)) return;
    try {
      await j(`/api/hotel/rooms/${encodeURIComponent(room.id)}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <tr
      className="border-t border-border transition-colors"
      style={{ backgroundColor: zebra ? `${TEAL}08` : "white" }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${TEAL}18`)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = zebra ? `${TEAL}08` : "white")}
    >
      <td className="py-2 pr-4 font-mono">{room.roomNumber}</td>
      <td className="py-2 pr-4">
        {edit ? (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            placeholder="Optional local label"
            aria-label="Display name"
            className="w-40 rounded border border-input bg-background px-1.5 py-1 text-sm"
          />
        ) : (
          <span className="font-medium" style={{ color: NAVY }}>
            {(room.displayName ?? "").trim() || <span className="text-muted-foreground">—</span>}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{room.n3StockName ?? "—"}</td>
      <td className="py-2 pr-4">
        {edit ? (
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-28 rounded border border-input bg-background px-1.5 py-1 text-sm"
          />
        ) : (
          room.roomType
        )}
      </td>
      <td className="py-2 pr-4">
        {edit ? (
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="w-16 rounded border border-input bg-background px-1.5 py-1 text-sm"
          />
        ) : (
          (room.floor ?? "—")
        )}
      </td>
      <td className="py-2 pr-4">
        {edit ? (
          <input
            type="number"
            min={1}
            value={occ}
            onChange={(e) => setOcc(e.target.value)}
            aria-label="Maximum guests"
            title={MAX_GUESTS_TOOLTIP}
            className="w-16 rounded border border-input bg-background px-1.5 py-1 text-sm"
          />
        ) : (
          room.maxOccupancy
        )}
      </td>
      <td className="py-2 pr-4">
        {edit ? (
          <input
            type="number"
            min={0}
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-24 rounded border border-input bg-background px-1.5 py-1 text-sm"
          />
        ) : (
          `MYR ${room.baseRate.toFixed(2)}`
        )}
      </td>
      <td className="py-2 pr-4">
        {edit ? (
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        ) : room.isActive ? (
          <span style={{ color: TEAL }}>●</span>
        ) : (
          <span className="text-muted-foreground">○</span>
        )}
      </td>
      <td className="py-2 pr-4">
        {canSetup ? (
          <div className="flex gap-2">
            {edit ? (
              <>
                <button onClick={save} className="text-xs font-medium" style={{ color: TEAL }}>
                  Save
                </button>
                <button onClick={() => setEdit(false)} className="text-xs text-muted-foreground">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEdit(true)}
                  className="text-xs font-medium"
                  style={{ color: NAVY }}
                >
                  Edit
                </button>
                <button onClick={remove} className="text-xs font-medium" style={{ color: ERR }}>
                  Remove
                </button>
              </>
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
