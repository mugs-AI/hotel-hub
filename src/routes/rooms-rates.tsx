import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";

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

const CARD = "rounded-lg border border-border bg-card p-5 shadow-sm";

function RoomsRatesPage() {
  const session = useSessionMe();
  const authed = session.data && session.data.authenticated === true ? session.data : null;
  const canView = authed ? hasPermission(authed.role, "hotel:rooms:view") : false;
  const canSetup = authed ? hasPermission(authed.role, "hotel:setup") : false;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#102A43" }}>
            Rooms &amp; Rates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your default N3 walk-in customer and map N3 stock codes to hotel rooms. Base
            rates are maintained locally in HotelHub (in MYR).
          </p>
        </div>
        {!authed ? null : !canView ? (
          <NoAccess />
        ) : (
          <RoomsRatesInner canSetup={canSetup} onN3Unauthorized={() => session.refetch()} />
        )}
      </div>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <div
      className="rounded-md border p-4 text-sm"
      style={{ borderColor: "#C2413B33", backgroundColor: "#C2413B1A" }}
    >
      <p className="font-semibold" style={{ color: "#C2413B" }}>
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
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: "#C2413B", color: "#C2413B" }}
        >
          {error}
        </div>
      ) : null}
      {settings ? (
        <SettingsCard
          settings={settings}
          canSetup={canSetup}
          onChange={setSettings}
          onN3Unauthorized={onN3Unauthorized}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Loading hotel settings…</p>
      )}
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
  const color = ready ? "#0F9D8A" : "#E5A93D";
  return (
    <div className={CARD} style={{ borderColor: `${color}55`, backgroundColor: `${color}15` }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "#102A43" }}>
            Hotel setup readiness
          </p>
          <p className="mt-1 text-sm" style={{ color }}>
            {ready ? "Ready for Reservations" : "Setup incomplete"}
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

function SettingsCard({
  settings,
  canSetup,
  onChange,
  onN3Unauthorized,
}: {
  settings: Settings;
  canSetup: boolean;
  onChange: (s: Settings) => void;
  onN3Unauthorized: () => void;
}) {
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [checkIn, setCheckIn] = useState(settings.standardCheckInTime);
  const [checkOut, setCheckOut] = useState(settings.standardCheckOutTime);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await j<{ settings: Settings }>("/api/hotel/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currency,
          timezone,
          standardCheckInTime: checkIn,
          standardCheckOutTime: checkOut,
        }),
      });
      onChange(r.settings);
      setMsg("Saved");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold" style={{ color: "#102A43" }}>
        Tenant settings
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Currency">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
            value={currency}
            disabled={!canSetup}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Timezone">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
            value={timezone}
            disabled={!canSetup}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </Field>
        <Field label="Check-in">
          <input
            type="time"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
            value={checkIn}
            disabled={!canSetup}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field label="Check-out">
          <input
            type="time"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
            value={checkOut}
            disabled={!canSetup}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
      </div>
      {canSetup ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "#102A43" }}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
          {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Read-only for your role.</p>
      )}
      <div className="mt-6 border-t border-border pt-4">
        <WalkInCustomerBlock
          current={settings.walkInCustomer}
          canSetup={canSetup}
          onChange={onChange}
          onN3Unauthorized={onN3Unauthorized}
        />
      </div>
    </section>
  );
}

function WalkInCustomerBlock({
  current,
  canSetup,
  onChange,
  onN3Unauthorized,
}: {
  current: Settings["walkInCustomer"];
  canSetup: boolean;
  onChange: (s: Settings) => void;
  onN3Unauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <h3 className="text-sm font-semibold" style={{ color: "#102A43" }}>
        Default Walk-in Customer
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Selected from your live N3 customer list. HotelHub verifies the code with N3 before saving.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          {current ? (
            <span>
              <span className="font-mono">{current.n3Code}</span>
              {" — "}
              <span>{current.n3Name ?? "—"}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Not configured</span>
          )}
        </div>
        {canSetup ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium"
          >
            {open ? "Close" : current ? "Change" : "Select"}
          </button>
        ) : null}
      </div>
      {open && canSetup ? (
        <N3Picker
          kind="customers"
          onPick={async (row) => {
            try {
              const r = await j<{ settings: Settings }>("/api/hotel/walk-in-customer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: row.code }),
              });
              onChange(r.settings);
              setOpen(false);
            } catch (e) {
              if ((e as Error).message === "n3_unauthorized") onN3Unauthorized();
              alert((e as Error).message);
            }
          }}
        />
      ) : null}
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
    <section className={CARD}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#102A43" }}>
            Rooms
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Room number equals the verified N3 stock code. Different rooms may carry different local
            base rates.
          </p>
        </div>
        {canSetup ? (
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
            style={{ backgroundColor: "#0F9D8A" }}
          >
            {adding ? "Cancel" : "Add room"}
          </button>
        ) : null}
      </div>
      {adding && canSetup ? (
        <div className="mt-4 rounded-md border border-dashed border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Pick an N3 stock code — it becomes the room number automatically.
          </p>
          <N3Picker
            kind="stocks"
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
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-4">Room #</th>
              <th className="py-2 pr-4">Stock name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Floor</th>
              <th className="py-2 pr-4">Occ.</th>
              <th className="py-2 pr-4">Base rate</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-4 text-center text-muted-foreground">
                  No rooms mapped yet.
                </td>
              </tr>
            ) : null}
            {rooms.map((r) => (
              <RoomRow key={r.id} room={r} canSetup={canSetup} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoomRow({
  room,
  canSetup,
  onChange,
}: {
  room: Room;
  canSetup: boolean;
  onChange: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState(room.roomType);
  const [floor, setFloor] = useState(room.floor ?? "");
  const [occ, setOcc] = useState(String(room.maxOccupancy));
  const [rate, setRate] = useState(String(room.baseRate));
  const [active, setActive] = useState(room.isActive);

  async function save() {
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
    <tr className="border-t border-border">
      <td className="py-2 pr-4 font-mono">{room.roomNumber}</td>
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
          <span style={{ color: "#0F9D8A" }}>●</span>
        ) : (
          <span className="text-muted-foreground">○</span>
        )}
      </td>
      <td className="py-2 pr-4">
        {canSetup ? (
          <div className="flex gap-2">
            {edit ? (
              <>
                <button onClick={save} className="text-xs font-medium" style={{ color: "#0F9D8A" }}>
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
                  style={{ color: "#102A43" }}
                >
                  Edit
                </button>
                <button
                  onClick={remove}
                  className="text-xs font-medium"
                  style={{ color: "#C2413B" }}
                >
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

function N3Picker<T extends "customers" | "stocks">({
  kind,
  onPick,
}: {
  kind: T;
  onPick: (row: T extends "customers" ? CustomerRow : StockRow) => void;
}) {
  type Row = CustomerRow | StockRow;
  type LoadState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; items: Row[]; total: number | null; hasMore: boolean; skip: number }
    | { kind: "error"; code: string };
  const top = 25;
  const [skip, setSkip] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [filter, setFilter] = useState("");

  const load = useCallback(
    async (nextSkip: number) => {
      setState({ kind: "loading" });
      try {
        const qs = new URLSearchParams({ top: String(top), skip: String(nextSkip) });
        const r = await j<{
          items: Row[];
          total: number | null;
          hasMore: boolean;
          skip: number;
        }>(`/api/n3/${kind}?${qs.toString()}`);
        setState({
          kind: "ok",
          items: r.items,
          total: r.total ?? null,
          hasMore: !!r.hasMore,
          skip: r.skip ?? nextSkip,
        });
      } catch (e) {
        const msg = (e as Error).message;
        setState({ kind: "error", code: msg });
      }
    },
    [kind],
  );

  // Fetch only when the page (skip) changes — filter is applied in memory.
  useEffect(() => {
    void load(skip);
  }, [load, skip]);

  const filtered = useMemo(() => {
    if (state.kind !== "ok") return [];
    const f = filter.trim().toLowerCase();
    if (!f) return state.items;
    return state.items.filter((row) => {
      const hay = `${row.code} ${row.name ?? ""}`.toLowerCase();
      return hay.includes(f);
    });
  }, [state, filter]);

  const canPrev = skip > 0;
  const isLoading = state.kind === "loading";
  const canNext = state.kind === "ok" && state.hasMore;

  const rangeLabel = (() => {
    if (state.kind !== "ok") return null;
    if (state.items.length === 0) return state.total != null ? `0 of ${state.total.toLocaleString()}` : "0 records";
    const from = state.skip + 1;
    const to = state.skip + state.items.length;
    if (state.total != null) {
      return `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${state.total.toLocaleString()}`;
    }
    return `Showing ${from.toLocaleString()}–${to.toLocaleString()}`;
  })();

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          placeholder="Filter loaded page…"
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          onClick={() => setSkip((s) => Math.max(0, s - top))}
          disabled={!canPrev || state.kind === "loading"}
          className="rounded-md border border-input px-2 py-1.5 text-xs disabled:opacity-50"
        >
          ← Prev
        </button>
        <button
          onClick={() => setSkip((s) => s + top)}
          disabled={!canNext || isLoading}
          className="rounded-md border border-input px-2 py-1.5 text-xs disabled:opacity-50"
        >
          Next →
        </button>
      </div>
      {rangeLabel ? (
        <p className="text-xs text-muted-foreground">{rangeLabel}</p>
      ) : null}
      {state.kind === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading from N3…</p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-xs" style={{ color: "#C2413B" }}>
          {state.code === "n3_unauthorized"
            ? "N3 session expired. Please re-launch from N3."
            : state.code === "n3_unavailable"
              ? "N3 is currently unavailable. Please retry."
              : state.code}
        </p>
      ) : null}
      <ul className="max-h-64 overflow-auto rounded-md border border-border divide-y divide-border">
        {filtered.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>
              <span className="font-mono">{row.code}</span>
              <span className="text-muted-foreground"> — {row.name ?? "—"}</span>
            </span>
            <button
              onClick={() => onPick(row as never)}
              className="rounded-md px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: "#0F9D8A" }}
            >
              Select
            </button>
          </li>
        ))}
        {state.kind === "ok" && filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            {state.items.length === 0
              ? "N3 returned no records for this page."
              : "No matches for this filter on the loaded page."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

