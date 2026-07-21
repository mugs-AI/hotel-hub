// Owner-only Settings page. Booking Sources management (rename, activate,
// deactivate, reorder, create). Immutable `source_code` is only shown as
// a badge; it is set once at creation time (auto-derived from display name
// unless explicitly provided) and can never be changed.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  useBookingSources,
  useCreateBookingSource,
  useUpdateBookingSource,
  type BookingSourceDTO,
} from "@/lib/reservations-client";
import { friendlyError } from "@/lib/reservations-ui";
import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HotelHub" },
      {
        name: "description",
        content: "Manage booking sources and tenant preferences.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell>
      <div className="min-h-full" style={{ backgroundColor: SOFT_BG }}>
        <SettingsInner />
      </div>
    </AppShell>
  );
}

function SettingsInner() {
  const session = useSessionMe();
  if (session.isLoading || !session.data) return null;
  if (session.data.authenticated === false) return null;
  const role = session.data.role;
  if (!hasPermission(role, "hotel:setup")) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div
          className="rounded-lg border bg-white p-6 text-sm"
          style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${GOLD}` }}
        >
          <p className="font-semibold" style={{ color: NAVY }}>
            Settings are Owner-only
          </p>
          <p className="mt-1 text-muted-foreground">
            Your HotelHub role does not have permission to edit tenant settings.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEAL }}>
          Settings
        </p>
        <h1 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>
          Booking Sources
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These sources appear in the New Reservation form and the Reservations filter. Only active
          sources can be assigned to new reservations; deactivated sources remain on existing
          reservations and stay visible in the list filter.
        </p>
      </header>
      <BookingSourcesCard />
    </div>
  );
}

function BookingSourcesCard() {
  const q = useBookingSources({ activeOnly: false });
  const sources = q.data?.sources ?? [];
  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Sources
        </h2>
        {q.isFetching && !q.isPending ? (
          <span className="text-[11px] text-muted-foreground">Refreshing…</span>
        ) : null}
      </div>

      {q.isPending ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : q.error ? (
        <p className="text-xs" style={{ color: "#C2413B" }}>
          {friendlyError(q.error.code, "Unable to load booking sources.")}
        </p>
      ) : sources.length === 0 ? (
        <p className="text-xs text-muted-foreground">No booking sources yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {sources.map((s, i) => (
            <SourceRow
              key={s.id}
              source={s}
              isFirst={i === 0}
              isLast={i === sources.length - 1}
            />
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-border/60 pt-4">
        <NewSourceForm />
      </div>
    </section>
  );
}

function SourceRow({
  source,
  isFirst,
  isLast,
}: {
  source: BookingSourceDTO;
  isFirst: boolean;
  isLast: boolean;
}) {
  const update = useUpdateBookingSource();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(source.displayName);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(friendlyError("display_name_required"));
      return;
    }
    try {
      await update.mutateAsync({ id: source.id, displayName: trimmed });
      setEditing(false);
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  async function toggleActive() {
    setError(null);
    try {
      await update.mutateAsync({ id: source.id, isActive: !source.isActive });
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  async function reorder(direction: "up" | "down") {
    setError(null);
    try {
      await update.mutateAsync({ id: source.id, direction });
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => reorder("up")}
          disabled={isFirst || update.isPending}
          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-[10px] disabled:opacity-40"
          aria-label="Move up"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => reorder("down")}
          disabled={isLast || update.isPending}
          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-[10px] disabled:opacity-40"
          aria-label="Move down"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: TEAL }}
            >
              <Save className="h-3 w-3" /> Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(source.displayName);
                setError(null);
              }}
              className="flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" style={{ color: NAVY }}>
              {source.displayName}
            </span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {source.sourceCode}
            </code>
            {!source.isActive ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ backgroundColor: `${GOLD}22`, color: "#8A5B00" }}
              >
                inactive
              </span>
            ) : null}
          </div>
        )}
        {error ? (
          <p className="mt-1 text-[11px]" style={{ color: "#C2413B" }}>
            {error}
          </p>
        ) : null}
      </div>
      {!editing ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={update.isPending}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs disabled:opacity-50"
          >
            {source.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function NewSourceForm() {
  const create = useCreateBookingSource();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError(friendlyError("display_name_required"));
      return;
    }
    try {
      await create.mutateAsync({ displayName: trimmed });
      setDisplayName("");
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: NAVY }}>
          Add booking source
        </span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Corporate travel"
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={create.isPending || !displayName.trim()}
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: TEAL }}
      >
        <Plus className="h-3.5 w-3.5" /> {create.isPending ? "Adding…" : "Add source"}
      </button>
      {error ? (
        <p className="basis-full text-[11px]" style={{ color: "#C2413B" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
