// Owner-only Settings panels: property basics, guest-editing controls and the
// N3 integration mapping. All writes go through same-origin, cookie
// authenticated API routes — never Supabase or N3 from the browser.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { resetHousekeepingBoardCache } from "@/lib/housekeeping-client";
import { SESSION_QUERY_KEY } from "@/lib/session-client";
import { N3Picker } from "@/components/N3Picker";
import { hotelJson, type HotelSettingsDTO } from "@/lib/hotel-settings-client";
import { friendlyError } from "@/lib/reservations-ui";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";

const CARD = "rounded-xl border bg-white p-5 shadow-sm";

export function useHotelSettings() {
  const [settings, setSettings] = useState<HotelSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings");
        if (!cancelled) setSettings(r.settings);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, setSettings, error };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium" style={{ color: NAVY }}>
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm disabled:opacity-60";

export function PropertyPanel({
  settings,
  onChange,
}: {
  settings: HotelSettingsDTO;
  onChange: (s: HotelSettingsDTO) => void;
}) {
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [checkIn, setCheckIn] = useState(settings.standardCheckInTime);
  const [checkOut, setCheckOut] = useState(settings.standardCheckOutTime);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings", {
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
      toast.success("Property settings saved");
    } catch (e) {
      toast.error(friendlyError((e as Error).message, "Unable to save property settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={CARD} style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${NAVY}` }}>
      <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
        Property
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Currency, timezone and the standard check-in / check-out times used across reservations, the
        calendar and late-checkout requests.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Currency">
          <input
            className={INPUT}
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Timezone">
          <input className={INPUT} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field label="Standard check-in">
          <input
            type="time"
            className={INPUT}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field label="Standard check-out">
          <input
            type="time"
            className={INPUT}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: NAVY }}
      >
        {saving ? "Saving…" : "Save property settings"}
      </button>
    </section>
  );
}

export function GuestControlsPanel({
  settings,
  onChange,
}: {
  settings: HotelSettingsDTO;
  onChange: (s: HotelSettingsDTO) => void;
}) {
  const [policy, setPolicy] = useState(settings.postCheckInGuestEditPolicy);
  const [allowPrimary, setAllowPrimary] = useState(
    settings.allowOwnerPrimaryGuestChangeAfterCheckIn,
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postCheckInGuestEditPolicy: policy,
          allowOwnerPrimaryGuestChangeAfterCheckIn: allowPrimary,
        }),
      });
      onChange(r.settings);
      toast.success("Guest controls saved");
    } catch (e) {
      toast.error(friendlyError((e as Error).message, "Unable to save guest controls."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={CARD} style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${TEAL}` }}>
      <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
        Guest controls
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Guest records are always fully editable before check-in. These rules decide what Front Desk
        may still change after a guest has checked in.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium" style={{ color: NAVY }}>
          After check-in
        </legend>
        {[
          {
            value: "contact_only" as const,
            label: "Contact details only",
            help: "Mobile, email and notes stay editable. Name, identity and address are locked.",
          },
          {
            value: "locked" as const,
            label: "Fully locked",
            help: "No guest field may be changed after check-in.",
          },
        ].map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
            style={{
              borderColor: policy === o.value ? TEAL : `${NAVY}1F`,
              backgroundColor: policy === o.value ? `${TEAL}0D` : "white",
            }}
          >
            <input
              type="radio"
              name="post-check-in-policy"
              className="mt-1"
              checked={policy === o.value}
              onChange={() => setPolicy(o.value)}
            />
            <span>
              <span className="font-medium" style={{ color: NAVY }}>
                {o.label}
              </span>
              <span className="block text-xs text-muted-foreground">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">
        These rules apply to Front Desk. An Owner can always make a controlled correction after
        check-in, and every such correction requires a written reason that is recorded in the
        reservation timeline.
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={allowPrimary}
          onChange={(e) => setAllowPrimary(e.target.checked)}
        />
        <span>
          <span className="font-medium" style={{ color: NAVY }}>
            Allow Owner to change the primary guest after check-in
          </span>
          <span className="block text-xs text-muted-foreground">
            Off by default. Front Desk can never change the primary guest after check-in.
          </span>
        </span>
      </label>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: TEAL }}
      >
        {saving ? "Saving…" : "Save guest controls"}
      </button>
    </section>
  );
}

export function HousekeepingPanel({
  settings,
  onChange,
}: {
  settings: HotelSettingsDTO;
  onChange: (s: HotelSettingsDTO) => void;
}) {
  const [mode, setMode] = useState(settings.housekeepingMode);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  async function save() {
    setSaving(true);
    try {
      const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ housekeepingMode: mode }),
      });
      onChange(r.settings);
      // The saved server response is authoritative. Drop the cached board so
      // the next visit to /housekeeping performs a fresh authoritative GET —
      // no hard refresh, no sign-out, no waiting for staleTime.
      resetHousekeepingBoardCache(qc);
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      toast.success("Housekeeping workflow saved");
    } catch (e) {
      toast.error(friendlyError((e as Error).message, "Unable to save the housekeeping workflow."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={CARD} style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${GOLD}` }}>
      <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
        Housekeeping workflow
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Both options use exactly the same room conditions and the same rules, and room turnaround
        always happens in the Housekeeping workspace — only the screens differ. This setting only
        selects the workflow mode. Switching is safe at any time and never changes a room&apos;s
        current condition.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium" style={{ color: NAVY }}>
          Who turns rooms around
        </legend>
        {[
          {
            value: "simple" as const,
            label: "Simple — Front Desk handles it",
            help: "Best for small properties. Front Desk or the Owner runs room turnaround in the Housekeeping workspace.",
          },
          {
            value: "dedicated" as const,
            label: "Dedicated housekeeping team",
            help: "The housekeeping team uses the Housekeeping workspace with the dedicated tools, with cleaning and checking as separate steps.",
          },
        ].map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
            style={{
              borderColor: mode === o.value ? TEAL : `${NAVY}1F`,
              backgroundColor: mode === o.value ? `${TEAL}0D` : "white",
            }}
          >
            <input
              type="radio"
              name="housekeeping-mode"
              className="mt-1"
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
            />
            <span>
              <span className="font-medium" style={{ color: NAVY }}>
                {o.label}
              </span>
              <span className="block text-xs text-muted-foreground">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        A room can only be checked into when it is <strong>Ready</strong>. Rooms that have never
        been set up for housekeeping block check-in until someone confirms their condition — set
        them up on the Housekeeping board.
      </p>

      <button
        type="button"
        onClick={save}
        disabled={saving || mode === settings.housekeepingMode}
        className="mt-4 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: NAVY }}
      >
        {saving ? "Saving…" : "Save housekeeping workflow"}
      </button>
    </section>
  );
}

export function ExceptionApprovalPanel({
  settings,
  onChange,
}: {
  settings: HotelSettingsDTO;
  onChange: (s: HotelSettingsDTO) => void;
}) {
  const [mode, setMode] = useState(settings.exceptionApprovalMode);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  async function save() {
    setSaving(true);
    try {
      const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exceptionApprovalMode: mode }),
      });
      onChange(r.settings);
      void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      toast.success("Reservation exception policy saved");
    } catch (e) {
      toast.error(friendlyError((e as Error).message, "Unable to save the approval policy."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={CARD} style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${TEAL}` }}>
      <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
        Reservation exception approvals
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Early check-in, late checkout, stay extension, room change and rate change are exceptions.
        Choose whether the front desk can carry them out directly, or whether the Owner must approve
        first. Guest-safety checks (room readiness, availability, capacity) always apply either way,
        and every action is recorded in the reservation timeline.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium" style={{ color: NAVY }}>
          Who decides exceptions
        </legend>
        {[
          {
            value: "owner_approval" as const,
            label: "Owner approval required",
            help: "Front Desk raises a request and the Owner approves or rejects it before anything changes.",
          },
          {
            value: "direct" as const,
            label: "Direct actions (recommended for small teams)",
            help: "Front Desk carries the exception out immediately. Nothing waits for the Owner.",
          },
        ].map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
            style={{
              borderColor: mode === o.value ? TEAL : `${NAVY}1F`,
              backgroundColor: mode === o.value ? `${TEAL}0D` : "white",
            }}
          >
            <input
              type="radio"
              name="exception-approval-mode"
              className="mt-1"
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
            />
            <span>
              <span className="font-medium" style={{ color: NAVY }}>
                {o.label}
              </span>
              <span className="block text-xs text-muted-foreground">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={save}
        disabled={saving || mode === settings.exceptionApprovalMode}
        className="mt-4 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: NAVY }}
      >
        {saving ? "Saving…" : "Save approval policy"}
      </button>
    </section>
  );
}

const RETENTION_OPTIONS = [30, 60, 90, 180, 365] as const;

export function HousekeepingRetentionPanel() {
  const [days, setDays] = useState<number>(30);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function purge() {
    setBusy(true);
    try {
      const r = await hotelJson<{ deleted: number; cutoff: string }>(
        "/api/hotel/housekeeping/purge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ days }),
        },
      );
      resetHousekeepingBoardCache(qc);
      setConfirming(false);
      toast.success(
        r.deleted === 0
          ? "Nothing to remove — no housekeeping history is older than that."
          : `Removed ${r.deleted} housekeeping history ${r.deleted === 1 ? "entry" : "entries"}.`,
      );
    } catch (e) {
      toast.error(friendlyError((e as Error).message, "Unable to clean up housekeeping history."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD} style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${GOLD}` }}>
      <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
        Housekeeping history retention
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Housekeeping history is kept until you remove it. Clearing older entries keeps the per-room
        history readable. Current room conditions are never affected, and the clean-up itself is
        recorded in the audit log.
      </p>

      <label className="mt-4 block text-xs font-medium" style={{ color: NAVY }}>
        Remove entries older than
        <select
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setConfirming(false);
          }}
          className="mt-1 block rounded-md border border-input bg-white px-2 py-1.5 text-sm"
        >
          {RETENTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-md border px-3 py-2 text-sm font-semibold"
          style={{ borderColor: GOLD, color: NAVY }}
        >
          Clean up history…
        </button>
      ) : (
        <div className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: `${GOLD}88` }}>
          <p style={{ color: NAVY }}>
            This permanently removes housekeeping history older than {days} days. It cannot be
            undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={purge}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
            >
              {busy ? "Cleaning up…" : "Yes, remove them"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-input px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function N3IntegrationPanel({
  settings,
  onChange,
  onN3Unauthorized,
}: {
  settings: HotelSettingsDTO;
  onChange: (s: HotelSettingsDTO) => void;
  onN3Unauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = settings.walkInCustomer;

  return (
    <div className="space-y-6">
      <section
        className={CARD}
        style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${GOLD}` }}
      >
        <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
          Default walk-in customer
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Selected from your live N3 customer list. HotelHub verifies the code with N3 before
          saving. HotelHub never writes transactions to N3 from this screen.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {current ? (
              <>
                <span className="font-mono" style={{ color: NAVY }}>
                  {current.n3Code}
                </span>
                <span className="text-muted-foreground"> — {current.n3Name ?? "—"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Not configured</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
          >
            {open ? "Close" : current ? "Change" : "Select"}
          </button>
        </div>
        {open ? (
          <N3Picker
            kind="customers"
            onPick={async (row) => {
              try {
                const r = await hotelJson<{ settings: HotelSettingsDTO }>(
                  "/api/hotel/walk-in-customer",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ code: row.code }),
                  },
                );
                onChange(r.settings);
                setOpen(false);
                toast.success("Walk-in customer saved");
              } catch (e) {
                const msg = (e as Error).message;
                if (msg === "n3_unauthorized") onN3Unauthorized();
                toast.error(friendlyError(msg, "Unable to save the walk-in customer."));
              }
            }}
          />
        ) : null}
      </section>

      <section
        className={CARD}
        style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${NAVY}` }}
      >
        <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
          N3 financial verification
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Read-only inquiry that confirms the live N3 Cloud contract for AR Receive Payments, Cash
          Sales, Customer Refunds and the GL Chart of Accounts. It never creates, voids or refunds
          an N3 transaction.
        </p>
        <a
          href="/settings/n3-financial-verification"
          className="mt-3 inline-flex rounded-md px-3 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: NAVY }}
        >
          Open console →
        </a>
      </section>
    </div>
  );
}
