import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { GuestContactSheet, SheetTrigger, type GuestContactInfo } from "@/components/InfoSheets";
import { useDepartures, checkoutErrorMessage } from "@/lib/checkout-client";
import { isoToMyDate } from "@/lib/malaysia-date";

export const Route = createFileRoute("/departures")({
  validateSearch: z.object({
    bucket: z.enum(["today", "overdue", "upcoming", "all"]).catch("today").default("today"),
  }),
  head: () => ({
    meta: [
      { title: "Departures — HotelHub" },
      {
        name: "description",
        content: "Checked-in departures for today, overdue and upcoming stays.",
      },
      { property: "og:title", content: "Departures — HotelHub" },
      {
        property: "og:description",
        content: "Checked-in departures for today, overdue and upcoming stays.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeparturesPage,
});

const BUCKETS = [
  { key: "today", label: "Departing today" },
  { key: "overdue", label: "Overdue occupied" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All checked in" },
] as const;

function DeparturesPage() {
  const { bucket } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useDepartures({ bucket, limit: 50 });
  const [contact, setContact] = useState<GuestContactInfo | null>(null);

  return (
    <AppShell>
      <div className="space-y-5">
        <GuestContactSheet info={contact} onClose={() => setContact(null)} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Departures</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only view of checked-in stays. Preparing checkout calculates a room-only folio and
            verifies deposits — it never posts to accounting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {BUCKETS.map((b) => {
            const active = b.key === bucket;
            const count = q.data?.counts[b.key];
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => navigate({ search: { bucket: b.key } })}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: active ? (b.key === "overdue" ? "#9B1C1C" : "#0F9D8A") : "white",
                  borderColor: b.key === "overdue" ? "#9B1C1C" : undefined,
                  color: active ? "white" : b.key === "overdue" ? "#9B1C1C" : "#102A43",
                }}
              >
                {b.label}
                {typeof count === "number" ? ` (${count})` : ""}
              </button>
            );
          })}
          {q.data ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Property date {isoToMyDate(q.data.propertyDate)}
            </span>
          ) : null}
        </div>

        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading departures…</p> : null}
        {q.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {checkoutErrorMessage(q.error)}
          </p>
        ) : null}

        {q.data ? (
          q.data.items.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              No checked-in reservations in this view.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[760px] table-fixed text-sm">
                <colgroup>
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "13%" }} />
                </colgroup>
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Booking</th>
                    <th className="px-4 py-2">Primary guest</th>
                    <th className="px-4 py-2">Rooms</th>
                    <th className="px-4 py-2">Guests</th>
                    <th className="px-4 py-2">Departure</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((it) => (
                    <tr
                      key={it.reservationId}
                      className="border-t border-border"
                      style={
                        it.bucket === "overdue"
                          ? { backgroundColor: "#FDECEC", borderLeft: "4px solid #9B1C1C" }
                          : undefined
                      }
                    >
                      <td className="px-3 py-3 font-mono text-xs">
                        <Link
                          to="/reservations/$id"
                          params={{ id: it.reservationId }}
                          title="Open reservation"
                          className="font-semibold text-teal-800 underline-offset-2 hover:underline focus-visible:underline"
                        >
                          {it.bookingReference}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        {it.primaryGuestName ? (
                          <SheetTrigger
                            label={`Guest contact for ${it.primaryGuestName}`}
                            onOpen={() =>
                              setContact({
                                guestName: it.primaryGuestName,
                                mobile: it.primaryGuestMobile,
                                bookingReference: it.bookingReference,
                              })
                            }
                          >
                            {it.primaryGuestName}
                          </SheetTrigger>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="block font-medium">{it.roomLabels[0] || "—"}</span>
                        {it.roomLabels.length > 1 ? (
                          <span className="block text-xs text-slate-600">
                            +{it.roomLabels.length - 1} more room(s)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">{it.guestCount}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-medium">
                        {isoToMyDate(it.departureDate)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className="rounded px-2 py-0.5 text-xs font-semibold"
                          style={{
                            backgroundColor:
                              it.bucket === "overdue"
                                ? "#9B1C1C"
                                : it.bucket === "today"
                                  ? "#E7F6F3"
                                  : "#F1F5F9",
                            color: it.bucket === "overdue" ? "#FFFFFF" : "#102A43",
                          }}
                        >
                          {it.bucket === "overdue"
                            ? "Overdue"
                            : it.bucket === "today"
                              ? "Today"
                              : "Upcoming"}
                        </span>
                        <span className="mt-1 block text-xs text-slate-600">Checked in</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          to="/reservations/$id/checkout"
                          params={{ id: it.reservationId }}
                          title="Prepare checkout preview"
                          className="inline-flex whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold text-white shadow-sm hover:underline hover:brightness-125 focus-visible:underline"
                          style={{ backgroundColor: "#102A43" }}
                        >
                          Preview →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </AppShell>
  );
}
