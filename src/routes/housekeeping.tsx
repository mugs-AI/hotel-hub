// /housekeeping — the Housekeeping workspace.
//
// PO-approved UI correction: Housekeeping is a normal operational workspace,
// not a dedicated-mode-only screen. Simple Owner / Front Desk get the light
// experience; Dedicated adds floor filters and per-room history. A housekeeper
// in Simple mode still has no housekeeping authority, so this route denies
// them — and the server refuses the board data too, so nothing here depends on
// the browser behaving.
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HousekeepingBoard } from "@/components/HousekeepingBoard";
import { HousekeepingModeBanner } from "@/components/HousekeepingModeBanner";
import { useSessionMe } from "@/lib/session-client";
import { housekeepingAuthority } from "@/lib/housekeeping";

const TITLE = "Housekeeping — HotelHub";
const DESCRIPTION =
  "Track room cleaning and readiness: see what needs attention, act on it, and confirm every room is done.";

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
          <p className="mt-1 text-sm text-muted-foreground">Track room cleaning and readiness.</p>
        </div>

        {authority.canOpenWorkspace ? (
          <>
            <HousekeepingModeBanner />
            <HousekeepingBoard variant={authority.canUseDedicatedWorkspace ? "dedicated" : "simple"} />
          </>
        ) : (
          <div
            role="status"
            className="max-w-3xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p className="font-semibold">Housekeeping is not available for your role.</p>
            <p className="mt-1">
              {authority.mode === "simple" && role === "housekeeper"
                ? "This property runs simple front-desk housekeeping, so the front desk turns rooms around. The Owner can switch to a dedicated housekeeping team in Settings → System."
                : "Your role does not have access to housekeeping."}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
