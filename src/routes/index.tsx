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
            Foundation build. Business modules ship in later MAF milestones.
          </p>
        </div>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Deferred MAF milestones</h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li>· Rooms, rates &amp; reservations</li>
            <li>· Deposit &amp; check-in</li>
            <li>· Checkout &amp; AR matching (RM100 / RM300 / RM200 flow)</li>
            <li>· Housekeeping &amp; maintenance</li>
            <li>· Cancellation, no-show &amp; refund approvals</li>
            <li>· Dashboard &amp; reports</li>
            <li>· Production verification</li>
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">What this foundation provides</h2>
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
            <li>· Empty navigation shell for future modules</li>
            <li>· N3 verification console (Owner-only) for capability probing</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
