// /housekeeping — the Dedicated Housekeeping workspace.
//
// This is the "one engine, two experiences" second surface: the full board
// with floor filters, per-room history and the complete action set. The
// Simple (Front Desk) experience renders the SAME board component in compact
// form on Rooms & Rates.
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HousekeepingBoard } from "@/components/HousekeepingBoard";
import { HousekeepingModeBanner } from "@/components/HousekeepingModeBanner";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";

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
  const role = session.data?.authenticated ? session.data.role : null;

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

        <HousekeepingModeBanner />

        {role && hasPermission(role, "hotel:housekeeping:view") ? (
          <HousekeepingBoard role={role} variant="dedicated" />
        ) : (
          <p className="rounded-md border border-border bg-white p-4 text-sm text-muted-foreground">
            Your role does not have access to housekeeping.
          </p>
        )}
      </div>
    </AppShell>
  );
}
