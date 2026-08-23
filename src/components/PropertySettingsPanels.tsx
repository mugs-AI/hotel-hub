// Owner-only Settings panels: property basics, guest-editing controls and the
// N3 integration mapping. All writes go through same-origin, cookie
// authenticated API routes — never Supabase or N3 from the browser.
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

  async function save() {
    setSaving(true);
    try {
      const r = await hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ housekeepingMode: mode }),
      });
      onChange(r.settings);
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
