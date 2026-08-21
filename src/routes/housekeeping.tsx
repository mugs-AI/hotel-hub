// /housekeeping — the Dedicated Housekeeping workspace.
//
// This is the "one engine, two experiences" second surface: the full board
// with floor filters, per-room history and the complete action set. The
// Simple (Front Desk) experience renders the SAME board component in compact
// form on Rooms & Rates.
//
// P1 correction: this route FAILS CLOSED. A property running simple
// front-desk housekeeping has no dedicated workspace, so direct navigation
// shows an explanation instead of a board — and the server refuses the board
// data too, so nothing here depends on the browser behaving.
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HousekeepingBoard } from "@/components/HousekeepingBoard";
import { HousekeepingModeBanner } from "@/components/HousekeepingModeBanner";
import { useSessionMe } from "@/lib/session-client";
import { DEDICATED_UNAVAILABLE_SIMPLE, housekeepingAuthority } from "@/lib/housekeeping";

const TITLE = "Housekeeping — HotelHub";
const DESCRIPTION =
  "Room turnaround board: see what needs cleaning, act on it, and confirm every room is ready before a guest arrives.";

export const Route = createFileRoute("/housekeeping")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HousekeepingPage,
});

function HousekeepingPage() {
  const session = useSessionMe();
  const authed = session.data?.authenticated ? session.data : null;
  const role = authed?.role ?? null;
  const authority = housekeepingAuthority(authed?.housekeepingMode ?? "simple", role);

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#102A43" }}>
            Housekeeping
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every room moves Ready → Dirty → Cleaning → Inspected → Ready. A room can only be
            checked into when it is Ready, so nothing here touches accounting, deposits or rates.
          </p>
        </div>

        {authority.canUseDedicatedWorkspace ? (
          <>
            <HousekeepingModeBanner />
            <HousekeepingBoard variant="dedicated" />
          </>
        ) : (
          <div
            role="status"
            className="max-w-3xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p className="font-semibold">The dedicated housekeeping workspace is not available.</p>
            <p className="mt-1">
              {authority.mode === "simple"
                ? DEDICATED_UNAVAILABLE_SIMPLE
                : "Your role does not have access to housekeeping."}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
