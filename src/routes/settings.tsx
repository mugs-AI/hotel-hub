// Owner-only Settings page. Booking Sources management with a polished,
// commercial-looking UI: summary cards, a table with status pills and
// usage counts, add/edit dialogs, and a deactivation confirmation.
// Immutable `source_code` is only shown as contextual metadata; it is
// derived once at creation time and can never be changed.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Info,
  Pencil,
  Plus,
  PowerOff,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  useBookingSources,
  useCreateBookingSource,
  useUpdateBookingSource,
  type BookingSourceDTO,
} from "@/lib/reservations-client";
import { friendlyError } from "@/lib/reservations-ui";
import { cn } from "@/lib/utils";

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
        content: "Configure booking sources and tenant preferences for your hotel.",
      },
      { property: "og:title", content: "Settings — HotelHub" },
      {
        property: "og:description",
        content: "Configure booking sources and tenant preferences for your hotel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell>
      <div className="min-h-full" style={{ backgroundColor: SOFT_BG }}>
        <TooltipProvider delayDuration={200}>
          <SettingsInner />
        </TooltipProvider>
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
      <div className="mx-auto max-w-3xl p-6 sm:p-8">
        <div
          className="rounded-xl border bg-white p-6 text-sm shadow-sm"
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
  return <BookingSourcesScreen />;
}

function BookingSourcesScreen() {
  const q = useBookingSources({ activeOnly: false });
  const sources = q.data?.sources ?? [];

  const stats = useMemo(() => {
    const total = sources.length;
    const active = sources.filter((s) => s.isActive).length;
    return { total, active, inactive: total - active };
  }, [sources]);

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:space-y-8 lg:px-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: TEAL }}
          >
            Hotel settings
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
            style={{ color: NAVY }}
          >
            Booking Sources
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Booking sources appear in the New Reservation form and the Reservations filter. Only
            active sources can be assigned to new reservations; deactivated sources are retained on
            historical reservations and remain visible as filter options.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          className="shrink-0 shadow-sm"
          style={{ backgroundColor: TEAL, color: "white" }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add booking source
        </Button>
      </header>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-label="Booking source overview"
      >
        <StatCard label="Total Sources" value={stats.total} accent={NAVY} />
        <StatCard label="Active" value={stats.active} accent={TEAL} />
        <StatCard label="Inactive" value={stats.inactive} accent={GOLD} />
      </section>

      <section
        className="overflow-hidden rounded-xl border bg-white shadow-sm"
        style={{ borderColor: `${NAVY}1F` }}
      >
        <div
          className="flex items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: `${NAVY}14` }}
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" style={{ color: NAVY }} />
            <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
              All sources
            </h2>
          </div>
          {q.isFetching && !q.isPending ? (
            <span className="text-[11px] text-muted-foreground">Refreshing…</span>
          ) : null}
        </div>

        {q.isPending ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading booking sources…</p>
        ) : q.error ? (
          <p className="px-5 py-8 text-sm" style={{ color: "#C2413B" }}>
            {friendlyError(q.error.code, "Unable to load booking sources.")}
          </p>
        ) : sources.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            No booking sources yet. Add your first source to start taking reservations.
          </p>
        ) : (
          <SourcesView sources={sources} />
        )}
      </section>

      <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div
      className="rounded-xl border bg-white px-5 py-4 shadow-sm"
      style={{ borderColor: `${NAVY}1F`, borderLeft: `3px solid ${accent}` }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: NAVY }}>
        {value}
      </p>
    </div>
  );
}

function SourcesView({ sources }: { sources: BookingSourceDTO[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr
              className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ backgroundColor: `${NAVY}08` }}
            >
              <th className="w-24 px-5 py-3">Order</th>
              <th className="px-5 py-3">Booking Source</th>
              <th className="px-5 py-3">Internal Code</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">
                <span className="inline-flex items-center gap-1">
                  Reservations
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex cursor-help"
                        aria-label="Number of existing reservations using this source."
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Number of existing reservations using this source.
                    </TooltipContent>
                  </Tooltip>
                </span>
              </th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <SourceTableRow
                key={s.id}
                source={s}
                isFirst={i === 0}
                isLast={i === sources.length - 1}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y md:hidden" style={{ borderColor: `${NAVY}14` }}>
        {sources.map((s, i) => (
          <SourceMobileCard
            key={s.id}
            source={s}
            isFirst={i === 0}
            isLast={i === sources.length - 1}
          />
        ))}
      </ul>
    </>
  );
}

function StatusPill({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
        style={{ backgroundColor: `${TEAL}1A`, color: "#0B7A6B" }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL }} aria-hidden />
        Active
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${GOLD}22`, color: "#8A5B00" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} aria-hidden />
      Inactive
    </span>
  );
}

function ReorderGroup({
  onUp,
  onDown,
  isFirst,
  isLast,
  disabled,
}: {
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border"
      style={{ borderColor: `${NAVY}22` }}
      role="group"
      aria-label="Reorder source"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onUp}
            disabled={isFirst || disabled}
            aria-label="Move up"
            className="flex h-8 w-8 items-center justify-center bg-white text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Move up</TooltipContent>
      </Tooltip>
      <div className="w-px" style={{ backgroundColor: `${NAVY}14` }} aria-hidden />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onDown}
            disabled={isLast || disabled}
            aria-label="Move down"
            className="flex h-8 w-8 items-center justify-center bg-white text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Move down</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SourceTableRow({
  source,
  isFirst,
  isLast,
}: {
  source: BookingSourceDTO;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const update = useUpdateBookingSource();

  async function reorder(direction: "up" | "down") {
    try {
      await update.mutateAsync({ id: source.id, direction });
      toast.success(`Moved ${source.displayName} ${direction === "up" ? "up" : "down"}.`);
    } catch (err) {
      toast.error(friendlyError((err as { code?: string }).code));
    }
  }

  async function activate() {
    try {
      await update.mutateAsync({ id: source.id, isActive: true });
      toast.success(`${source.displayName} restored.`);
    } catch (err) {
      toast.error(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <>
      <tr
        className={cn("border-t align-middle", !source.isActive && "bg-muted/40")}
        style={{ borderColor: `${NAVY}12` }}
      >
        <td className="h-[64px] px-5">
          <ReorderGroup
            onUp={() => reorder("up")}
            onDown={() => reorder("down")}
            isFirst={isFirst}
            isLast={isLast}
            disabled={update.isPending}
          />
        </td>
        <td className="px-5">
          <span className="text-sm font-semibold" style={{ color: NAVY }}>
            {source.displayName}
          </span>
        </td>
        <td className="px-5">
          <code
            className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            title="Internal code — generated once and immutable."
          >
            {source.sourceCode}
          </code>
        </td>
        <td className="px-5">
          <StatusPill active={source.isActive} />
        </td>
        <td className="px-5">
          <span
            className="tabular-nums text-sm"
            style={{ color: source.usedCount === 0 ? "#6b7280" : NAVY }}
          >
            {source.usedCount}
          </span>
        </td>
        <td className="px-5 py-3 text-right">
          <div className="inline-flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              disabled={update.isPending}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
            {source.isActive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeactivateOpen(true)}
                disabled={update.isPending}
                className="text-[#8A5B00] hover:bg-[#FBEFD3]"
                style={{ borderColor: `${GOLD}66` }}
              >
                <PowerOff className="mr-1.5 h-3.5 w-3.5" /> Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={activate}
                disabled={update.isPending}
                style={{ backgroundColor: TEAL, color: "white" }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Restore
              </Button>
            )}
          </div>
        </td>
      </tr>
      <EditSourceDialog open={editOpen} onOpenChange={setEditOpen} source={source} />
      <DeactivateDialog open={deactivateOpen} onOpenChange={setDeactivateOpen} source={source} />
    </>
  );
}

function SourceMobileCard({
  source,
  isFirst,
  isLast,
}: {
  source: BookingSourceDTO;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const update = useUpdateBookingSource();

  async function reorder(direction: "up" | "down") {
    try {
      await update.mutateAsync({ id: source.id, direction });
    } catch (err) {
      toast.error(friendlyError((err as { code?: string }).code));
    }
  }
  async function activate() {
    try {
      await update.mutateAsync({ id: source.id, isActive: true });
      toast.success(`${source.displayName} restored.`);
    } catch (err) {
      toast.error(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <li className={cn("px-4 py-4", !source.isActive && "bg-muted/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: NAVY }}>
            {source.displayName}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {source.sourceCode}
            </code>
            <StatusPill active={source.isActive} />
          </div>
        </div>
        <ReorderGroup
          onUp={() => reorder("up")}
          onDown={() => reorder("down")}
          isFirst={isFirst}
          isLast={isLast}
          disabled={update.isPending}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium tabular-nums" style={{ color: NAVY }}>
            {source.usedCount}
          </span>{" "}
          reservation{source.usedCount === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
          {source.isActive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeactivateOpen(true)}
              className="text-[#8A5B00]"
              style={{ borderColor: `${GOLD}66` }}
            >
              Deactivate
            </Button>
          ) : (
            <Button size="sm" onClick={activate} style={{ backgroundColor: TEAL, color: "white" }}>
              Restore
            </Button>
          )}
        </div>
      </div>
      <EditSourceDialog open={editOpen} onOpenChange={setEditOpen} source={source} />
      <DeactivateDialog open={deactivateOpen} onOpenChange={setDeactivateOpen} source={source} />
    </li>
  );
}

// ---------- Dialogs ----------

function useAutoFocusRef(open: boolean) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => ref.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);
  return ref;
}

function AddSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateBookingSource();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useAutoFocusRef(open);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(friendlyError("display_name_required"));
      return;
    }
    try {
      const res = await create.mutateAsync({ displayName: trimmed });
      toast.success(`Added “${res.source.displayName}”.`);
      onOpenChange(false);
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle style={{ color: NAVY }}>Add booking source</DialogTitle>
            <DialogDescription>Create a new source for your reservation intake.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-source-name">Source name</Label>
              <Input
                id="new-source-name"
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Corporate Travel"
                maxLength={80}
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                The internal code is generated automatically and cannot be changed later.
              </p>
            </div>
            {error ? (
              <p className="text-[12px]" style={{ color: "#C2413B" }}>
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !name.trim()}
              style={{ backgroundColor: TEAL, color: "white" }}
            >
              {create.isPending ? "Adding…" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSourceDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: BookingSourceDTO;
}) {
  const update = useUpdateBookingSource();
  const [name, setName] = useState(source.displayName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useAutoFocusRef(open);

  useEffect(() => {
    if (open) {
      setName(source.displayName);
      setError(null);
    }
  }, [open, source.displayName]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(friendlyError("display_name_required"));
      return;
    }
    if (trimmed === source.displayName) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: source.id, displayName: trimmed });
      toast.success("Booking source updated.");
      onOpenChange(false);
    } catch (err) {
      setError(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle style={{ color: NAVY }}>Edit booking source</DialogTitle>
            <DialogDescription>Rename this booking source.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-source-name-${source.id}`}>Source name</Label>
              <Input
                id={`edit-source-name-${source.id}`}
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Internal code</Label>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">
                  {source.sourceCode}
                </code>
                <span className="text-[11px] text-muted-foreground">
                  Read-only — cannot be changed.
                </span>
              </div>
            </div>
            {error ? (
              <p className="text-[12px]" style={{ color: "#C2413B" }}>
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={update.isPending || !name.trim()}
              style={{ backgroundColor: TEAL, color: "white" }}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: BookingSourceDTO;
}) {
  const update = useUpdateBookingSource();

  async function handleConfirm() {
    try {
      await update.mutateAsync({ id: source.id, isActive: false });
      toast.success(`“${source.displayName}” deactivated.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(friendlyError((err as { code?: string }).code));
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle style={{ color: NAVY }}>Deactivate booking source?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium" style={{ color: NAVY }}>
                  {source.displayName}
                </span>{" "}
                will no longer be available for new reservations. Existing reservation history will
                be preserved.
              </p>
              {source.usedCount > 0 ? (
                <p className="text-muted-foreground">
                  Used by{" "}
                  <span className="font-medium" style={{ color: NAVY }}>
                    {source.usedCount}
                  </span>{" "}
                  existing reservation{source.usedCount === 1 ? "" : "s"}.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={update.isPending}
            className="bg-[#B7791F] text-white hover:bg-[#A2691A]"
          >
            {update.isPending ? "Deactivating…" : "Deactivate source"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
