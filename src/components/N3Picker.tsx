// Shared N3 record picker (customers / stocks). Loads the entire
// authenticated tenant list once, then searches in memory — searching never
// triggers a new N3 request. Used by Rooms & Rates and by Settings.
import { useEffect, useMemo, useState } from "react";
import { matchesQuery } from "@/lib/n3-gateway.browser";
import { paginate, pageWindow, PAGE_SIZE_OPTIONS, type PageSize } from "@/lib/search-pagination";
import { isStockMapped, selectIfAllowed } from "@/lib/room-picker";
import { hotelJson as j, type N3CustomerRow, type N3StockRow } from "@/lib/hotel-settings-client";

type CustomerRow = N3CustomerRow;
type StockRow = N3StockRow;

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const ERR = "#C2413B";
const MAPPED_STOCK_TOOLTIP = "This N3 Stock Code is already mapped to a room.";

// -------------------------------------------------------------------------
// N3 Picker — loads the ENTIRE authenticated tenant list once, then all
// searching happens in memory. Search never triggers a new N3 request.
// -------------------------------------------------------------------------

type PickerLoad<Row> =
  | { kind: "loading" }
  | { kind: "ok"; items: Row[]; total: number }
  | { kind: "error"; code: string };

export function N3Picker<T extends "customers" | "stocks">({
  kind,
  onPick,
  disabledCodes,
}: {
  kind: T;
  onPick: (row: T extends "customers" ? CustomerRow : StockRow) => void;
  disabledCodes?: ReadonlySet<string>;
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
          {kind === "customers" ? "Loading all live N3 customers…" : "Loading all live N3 stocks…"}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-xs" style={{ color: ERR }}>
          {state.code === "n3_unauthorized"
            ? "Your N3 session has expired. Reopen HotelHub from N3 → Marketplace → My Apps."
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
        {paged.pageItems.map((row, i) => {
          const mapped = disabledCodes ? isStockMapped(row.code, disabledCodes) : false;
          return (
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
                {mapped ? (
                  <span
                    className="ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ backgroundColor: `${NAVY}1A`, color: NAVY }}
                  >
                    Mapped
                  </span>
                ) : null}
              </span>
              <button
                onClick={() => {
                  if (mapped || !disabledCodes) {
                    if (mapped) return;
                    onPick(row as never);
                    return;
                  }
                  selectIfAllowed(row, disabledCodes, (r) => onPick(r as never));
                }}
                disabled={mapped}
                aria-disabled={mapped || undefined}
                title={mapped ? MAPPED_STOCK_TOOLTIP : undefined}
                className="rounded-md px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed"
                style={
                  mapped
                    ? { backgroundColor: `${NAVY}55`, color: "white", opacity: 0.75 }
                    : { backgroundColor: TEAL }
                }
              >
                {mapped ? "Added" : "Select"}
              </button>
            </li>
          );
        })}
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
            <PagerButton onClick={() => setPage(1)} disabled={paged.page === 1} label="« First" />
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
