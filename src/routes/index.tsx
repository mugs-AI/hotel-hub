import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HotelHub — Boutique Hotel System" },
      {
        name: "description",
        content:
          "Front-desk operations for a boutique hotel, integrated with N3 AI Cloud Accounting.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to HotelHub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Boutique hotel operations, integrated with N3 AI Cloud Accounting.
          </p>
        </div>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Available today</h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li>· Rooms &amp; Rates — N3 Stock Code mapping with local base rates</li>
            <li>· Reservations — create, edit, cancel, calendar and registration print</li>
            <li>· Guest and room editing with capacity-aware assignment</li>
            <li>· Deposit ledger with controlled Owner-only N3 deposit write</li>
            <li>· Check-in and in-stay operations with Owner approvals</li>
            <li>· Departures and read-only Prepare Checkout preview</li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Planned next</h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li>· CashMemo posting and deposit matching</li>
            <li>· Final balance collection and checkout completion</li>
            <li>· Housekeeping &amp; maintenance workflow</li>
            <li>· Refund approvals</li>
            <li>· Dashboard &amp; reports</li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Platform foundations</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li>
              · Secure N3 launch/auth (Path A: <code>?token=</code> from My Apps)
            </li>
            <li>· Dev-only API-key sign-in (Path B), stripped from production</li>
            <li>· Same-origin gateway — browser never calls N3 hosts directly</li>
            <li>
              · Session header (company, tenant, user) captured at launch and read from the
              encrypted HttpOnly session cookie on each page load — not re-fetched from N3.
            </li>
            <li>· N3 verification console (Owner-only) for capability probing</li>
          </ul>
        </section>

      </div>
    </AppShell>
  );
}
