import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { matchesQuery } from "@/lib/n3-gateway.browser";
import {
  paginate,
  pageWindow,
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from "@/lib/search-pagination";

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
          <RoomsRatesInner canSetup={canSetup} onN3Unauthorized={() => session.refetch()} />
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
  const color = ready ? TEAL : GOLD;
  return (
    <div
      className={CARD}
      style={{ borderColor: `${color}66`, backgroundColor: `${color}12`, borderLeft: `4px solid ${color}` }}
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
    <section className={CARD} style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}>
      <SectionHeader label="Tenant settings" accent={NAVY} tag="Config" />
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
            style={{ backgroundColor: NAVY }}
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
    <div
      className="rounded-md p-4"
      style={{ backgroundColor: `${GOLD}10`, borderLeft: `3px solid ${GOLD}` }}
    >
      <SectionHeader label="Default Walk-in Customer" accent={GOLD} tag="N3" />
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
            className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
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
          style={{ backgroundColor: `${TEAL}0D`, borderLeft: `3px solid ${TEAL}`, border: `1px dashed ${TEAL}55` }}
        >
          <p className="text-xs font-semibold" style={{ color: NAVY }}>
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
            <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
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
            {rooms.map((r, i) => (
              <RoomRow key={r.id} room={r} zebra={i % 2 === 1} canSetup={canSetup} onChange={onChange} />
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
    <tr
      className="border-t border-border transition-colors"
      style={{ backgroundColor: zebra ? `${TEAL}08` : "white" }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${TEAL}18`)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = zebra ? `${TEAL}08` : "white")}
    >
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
                <button
                  onClick={remove}
                  className="text-xs font-medium"
                  style={{ color: ERR }}
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

// -------------------------------------------------------------------------
// N3 Picker — loads the ENTIRE authenticated tenant list once, then all
// searching happens in memory. Search never triggers a new N3 request.
// -------------------------------------------------------------------------

type PickerLoad<Row> =
  | { kind: "loading" }
  | { kind: "ok"; items: Row[]; total: number }
  | { kind: "error"; code: string };

function N3Picker<T extends "customers" | "stocks">({
  kind,
  onPick,
}: {
  kind: T;
  onPick: (row: T extends "customers" ? CustomerRow : StockRow) => void;
}) {
  type Row = CustomerRow | StockRow;
  const [state, setState] = useState<PickerLoad<Row>>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await j<{ items: Row[]; total: number }>(`/api/n3/${kind}/all`);
        if (cancelled) return;
        setState({ kind: "ok", items: res.items, total: res.total });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "error", code: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const filtered = useMemo(() => {
    if (state.kind !== "ok") return [] as Row[];
    if (!query.trim()) return state.items;
    return state.items.filter((r) => matchesQuery(query, r.code, r.name));
  }, [state, query]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  const paged = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);
  const win = useMemo(() => pageWindow(paged.page, paged.totalPages), [paged]);

  const kindLabel = kind === "customers" ? "customers" : "stocks";
  const placeholder =
    kind === "customers"
      ? "Search all customers by code or name…"
      : "Search all stocks by code or name…";

  return (
    <div className="mt-3 space-y-3">
      {/* Prominent search bar */}
      <div
        className="flex items-center gap-2 rounded-lg border-2 bg-white px-3 py-2 shadow-sm"
        style={{ borderColor: `${TEAL}55` }}
      >
        <span aria-hidden style={{ color: TEAL }}>
          🔍
        </span>
        <input
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none disabled:opacity-60"
          value={query}
          disabled={state.kind !== "ok"}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${kindLabel}`}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ✕ Clear
          </button>
        ) : null}
      </div>

      {/* Status line */}
      {state.kind === "loading" ? (
        <p className="text-xs" style={{ color: NAVY }}>
          {kind === "customers"
            ? "Loading all live N3 customers…"
            : "Loading all live N3 stocks…"}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-xs" style={{ color: ERR }}>
          {state.code === "n3_unauthorized"
            ? "N3 session expired. Please re-launch from N3."
            : state.code === "n3_unavailable"
              ? "N3 is currently unavailable. Please retry."
              : state.code === "n3_incomplete"
                ? "N3 returned an incomplete list. Please retry."
                : state.code}
        </p>
      ) : null}
      {state.kind === "ok" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {state.total.toLocaleString()} live N3 {kindLabel} loaded
          </span>
          <span>
            {query.trim()
              ? filtered.length === 0
                ? `0 results for "${query}"`
                : `${paged.from.toLocaleString()}–${paged.to.toLocaleString()} of ${filtered.length.toLocaleString()} results`
              : `${paged.from.toLocaleString()}–${paged.to.toLocaleString()} of ${state.total.toLocaleString()}`}
          </span>
        </div>
      ) : null}

      {/* Result list */}
      <ul
        className="max-h-72 overflow-auto rounded-md border bg-white divide-y divide-border"
        style={{ borderColor: `${NAVY}22` }}
      >
        {paged.pageItems.map((row, i) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors"
            style={{ backgroundColor: i % 2 === 1 ? `${TEAL}08` : "white" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${TEAL}1F`)}
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = i % 2 === 1 ? `${TEAL}08` : "white")
            }
          >
            <span>
              <span className="font-mono" style={{ color: NAVY }}>
                {row.code}
              </span>
              <span className="text-muted-foreground"> — {row.name ?? "—"}</span>
            </span>
            <button
              onClick={() => onPick(row as never)}
              className="rounded-md px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: TEAL }}
            >
              Select
            </button>
          </li>
        ))}
        {state.kind === "ok" && paged.pageItems.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-muted-foreground">
            {query.trim() ? `No matches for "${query}".` : "N3 returned no records."}
          </li>
        ) : null}
      </ul>

      {/* Pager */}
      {state.kind === "ok" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Rows per page</span>
            <select
              className="rounded-md border border-input bg-white px-1.5 py-1"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1">
            <PagerButton
              onClick={() => setPage(1)}
              disabled={paged.page === 1}
              label="« First"
            />
            <PagerButton
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={paged.page === 1}
              label="‹ Prev"
            />
            {win.map((w, i) =>
              w === "…" ? (
                <span key={`e-${i}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={w}
                  onClick={() => setPage(w)}
                  aria-current={w === paged.page ? "page" : undefined}
                  className="min-w-[28px] rounded-md border border-input px-2 py-1"
                  style={
                    w === paged.page
                      ? { backgroundColor: TEAL, color: "white", borderColor: TEAL }
                      : { backgroundColor: "white", color: NAVY }
                  }
                >
                  {w}
                </button>
              ),
            )}
            <PagerButton
              onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))}
              disabled={paged.page === paged.totalPages}
              label="Next ›"
            />
            <PagerButton
              onClick={() => setPage(paged.totalPages)}
              disabled={paged.page === paged.totalPages}
              label="Last »"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-input bg-white px-2 py-1 disabled:opacity-40"
      style={{ color: NAVY }}
    >
      {label}
    </button>
  );
}
