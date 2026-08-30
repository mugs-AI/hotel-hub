// HH-GOLIVE-01A UAT correction — accessible, searchable N3 selector.
//
// Owners choose an N3 record by its human-readable code and name. The
// immutable identifier is carried in the selection payload but is never shown
// and never typed by hand. When HotelHub has no proven read-only contract for
// the resource, the control renders disabled with a truthful explanation
// instead of falling back to a free-text identifier box.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { hotelJson } from "@/lib/hotel-settings-client";
import { matchesQuery } from "@/lib/n3-gateway.browser";
import { PAGE_SIZE_OPTIONS, paginate, type PageSize } from "@/lib/search-pagination";
import {
  selectorRequiresStock,
  SELECTOR_STOCK_REQUIRED_TEXT,
  SELECTOR_UNVERIFIED_TEXT,
  type N3SelectorKind,
  type N3SelectorLoad,
  type N3SelectorRow,
} from "@/lib/n3-selectors";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const ERR = "#C2413B";

type State = { kind: "loading" } | { kind: "loaded"; load: N3SelectorLoad } | { kind: "error" };

export type N3Selection = { id: string; code: string; name: string | null };

export function N3SelectorField({
  kind,
  label,
  value,
  onSelect,
  onClear,
  disabled,
  describedById,
  stockId,
}: {
  kind: N3SelectorKind;
  label: string;
  /** Current human-readable selection, or null. */
  value: { code: string | null; name: string | null } | null;
  onSelect: (row: N3Selection) => void;
  onClear?: () => void;
  disabled?: boolean;
  describedById?: string;
  /**
   * Immutable N3 Stock identifier currently in effect. Required for the
   * stock-linked unit-of-measure list; ignored by every other selector.
   */
  stockId?: string | null;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(1);

  const needsStock = selectorRequiresStock(kind);
  const stockContext = needsStock ? (stockId ?? null) : null;
  const stockMissing = needsStock && !stockContext;

  useEffect(() => {
    // A stock-linked list is never requested without its stock context.
    if (stockMissing) {
      setOpen(false);
      setState({ kind: "loaded", load: { status: "stock_context_required", kind } });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const suffix = stockContext ? `?stockId=${encodeURIComponent(stockContext)}` : "";
        const load = await hotelJson<N3SelectorLoad>(`/api/n3/selectors/${kind}${suffix}`);
        if (!cancelled) setState({ kind: "loaded", load });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, stockContext, stockMissing]);

  const load = state.kind === "loaded" ? state.load : null;
  const unverified = load?.status === "contract_unverified";
  const awaitingStock = stockMissing || load?.status === "stock_context_required";
  const rows: N3SelectorRow[] = load?.status === "ok" ? load.items : [];

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    return rows.filter((r) => matchesQuery(query, r.code, r.name));
  }, [rows, query]);

  useEffect(() => setPage(1), [query, pageSize]);
  const paged = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);

  const selectedText = value?.code
    ? value.name
      ? `${value.code} — ${value.name}`
      : value.code
    : "Not chosen";

  const blocked = Boolean(disabled) || unverified || awaitingStock || state.kind === "error";

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium" style={{ color: NAVY }}>
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded border px-2 py-1 text-sm"
          style={{ borderColor: `${NAVY}22`, color: value?.code ? NAVY : "#6B7A8C" }}
          data-testid={`selector-value-${kind}`}
        >
          {unverified ? SELECTOR_UNVERIFIED_TEXT : selectedText}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked}
          aria-disabled={blocked || undefined}
          aria-describedby={describedById}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close list" : value?.code ? "Change" : "Choose"}
        </Button>
        {value?.code && onClear ? (
          <Button type="button" size="sm" variant="ghost" disabled={blocked} onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>

      {unverified ? (
        <p className="text-sm" style={{ color: ERR }}>
          {SELECTOR_UNVERIFIED_TEXT}. Still needed: {load.missingEvidence}
        </p>
      ) : null}
      {awaitingStock ? (
        <p className="text-sm text-muted-foreground" data-testid={`selector-needs-stock-${kind}`}>
          {SELECTOR_STOCK_REQUIRED_TEXT}.
        </p>
      ) : null}
      {state.kind === "error" || load?.status === "unavailable" ? (
        <p className="text-sm" style={{ color: ERR }}>
          N3 could not be reached for this list. Nothing has been changed.
        </p>
      ) : null}
      {state.kind === "loading" ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {open && load?.status === "ok" ? (
        <div className="mt-2 space-y-2 rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
          <input
            className="w-full rounded border px-2 py-2 text-sm"
            placeholder="Search by code or name…"
            aria-label={`Search ${label}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            {filtered.length.toLocaleString()} of {load.total.toLocaleString()} available
          </p>
          <ul className="max-h-60 divide-y overflow-auto rounded border bg-white">
            {paged.pageItems.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-2 py-2">
                <span className="text-sm" style={{ color: NAVY }}>
                  <span className="font-mono">{row.code}</span>
                  <span className="text-muted-foreground"> — {row.name ?? "—"}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  style={{ backgroundColor: TEAL }}
                  onClick={() => {
                    onSelect({ id: row.id, code: row.code, name: row.name });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  Select
                </Button>
              </li>
            ))}
            {paged.pageItems.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">No matches.</li>
            ) : null}
          </ul>
          <div className="flex items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">Rows</span>
              <select
                className="rounded border px-1.5 py-1"
                aria-label={`Rows per page for ${label}`}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={paged.page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="text-muted-foreground">
                {paged.page} / {paged.totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={paged.page === paged.totalPages}
                onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
