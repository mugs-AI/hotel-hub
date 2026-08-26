// HH-AUTH-02 — Settings → User Control.
//
// Owner-only. Lists the current tenant's ACTIVE N3 users (name + email for
// recognition) and lets the Owner grant exactly one of: No access, Front
// Desk, Housekeeper. Authorization always uses the immutable N3 identifier,
// which is never rendered. The current N3 Owner row is locked.
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MANAGED_ROLES, type AccessChoice, type UserControlRow } from "@/lib/user-control";
import { useUserControl, userControlErrorText } from "@/lib/user-control-client";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";

const CHOICES: Array<{ id: AccessChoice; label: string }> = [
  { id: "none", label: "No access" },
  ...MANAGED_ROLES.map((r) => ({
    id: r as AccessChoice,
    label: r === "front_desk" ? "Front Desk" : "Housekeeper",
  })),
];

export function accessLabel(access: UserControlRow["access"]): string {
  if (access === "owner") return "Owner";
  if (access === "front_desk") return "Front Desk";
  if (access === "housekeeper") return "Housekeeper";
  return "No access";
}

export function UserControlPanel() {
  const {
    data,
    errorCode,
    isLoading,
    savingKey,
    savedKey,
    rowErrors,
    refresh,
    setAccess,
  } = useUserControl(true);

  return (
    <section
      aria-labelledby="user-control-heading"
      className="rounded-xl border bg-white p-5 shadow-sm sm:p-6"
      style={{ borderColor: `${NAVY}22` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="user-control-heading" className="text-base font-semibold" style={{ color: NAVY }}>
            User Control
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Give individual N3 users access to HotelHub. Users come from this property&apos;s N3
            user directory — access follows the N3 account, not the email address.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={isLoading}
          aria-label="Reload N3 users"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
          Reload
        </Button>
      </header>

      <div className="mt-4" aria-live="polite">
        {isLoading && !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading N3 users…
          </p>
        ) : null}

        {errorCode ? (
          <div
            role="alert"
            className="rounded-lg border bg-white p-4 text-sm"
            style={{ borderColor: `${GOLD}66`, borderLeft: `4px solid ${GOLD}` }}
          >
            <p className="font-medium" style={{ color: NAVY }}>
              User Control is unavailable
            </p>
            <p className="mt-1 text-muted-foreground">{userControlErrorText(errorCode)}</p>
          </div>
        ) : null}

        {data && data.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No active N3 users were returned for this property.
          </p>
        ) : null}

        {data && data.rows.length > 0 ? (
          <>
            {data.skippedWithoutIdentifier > 0 ? (
              <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GOLD }} />
                {data.skippedWithoutIdentifier} N3 user(s) were hidden because N3 did not return a
                stable identifier for them.
              </p>
            ) : null}
            {!data.actorKeyAlignsWithN3Id ? (
              <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GOLD }} />
                Your launch identity does not line up with the identifier N3 reports for you.
                Access saved here may not apply until that is resolved.
              </p>
            ) : null}

            <ul className="divide-y rounded-lg border" style={{ borderColor: `${NAVY}1A` }}>
              {data.rows.map((row) => (
                <li key={row.n3UserKey} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: NAVY }}>
                      {row.displayName ?? row.email ?? "Unnamed N3 user"}
                    </p>
                    {row.email ? (
                      <p className="truncate text-sm text-muted-foreground">{row.email}</p>
                    ) : null}
                    {row.staleLocalRole === "owner" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        An old Owner record exists for this user. It grants nothing.
                      </p>
                    ) : null}
                    {rowErrors[row.n3UserKey] ? (
                      <p role="alert" className="mt-1 text-sm" style={{ color: "#B4451F" }}>
                        {userControlErrorText(rowErrors[row.n3UserKey])}
                      </p>
                    ) : null}
                  </div>

                  {row.isCurrentN3Owner ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                      style={{ backgroundColor: `${TEAL}1A`, color: NAVY }}
                    >
                      <ShieldCheck className="h-4 w-4" style={{ color: TEAL }} />
                      Owner (from N3)
                    </span>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label={`HotelHub access for ${row.displayName ?? row.email ?? "this user"}`}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      {CHOICES.map((choice) => {
                        const selected = row.access === choice.id;
                        const busy = savingKey === row.n3UserKey;
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={busy}
                            onClick={() => {
                              if (!selected) void setAccess(row.n3UserKey, choice.id);
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-60",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                            )}
                            style={
                              selected
                                ? { backgroundColor: NAVY, color: "#fff", borderColor: NAVY }
                                : { borderColor: `${NAVY}33`, color: NAVY }
                            }
                          >
                            {choice.label}
                          </button>
                        );
                      })}
                      {savingKey === row.n3UserKey ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
                      ) : null}
                      {savedKey === row.n3UserKey && savingKey === null ? (
                        <Check className="h-4 w-4" style={{ color: TEAL }} aria-label="Saved" />
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}
