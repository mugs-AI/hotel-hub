import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useSessionMe, useSignOut, useDevConnect, type SessionMe } from "@/lib/session-client";
import { hasPermission, type Permission } from "@/lib/rbac";

type NavItem = {
  to: "/" | "/verification";
  label: string;
  permission?: Permission;
  disabled?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", permission: "app:view" },
  { to: "/verification", label: "N3 Verification Console", permission: "n3:verify" },
  // Deferred MAF milestones — placeholders only.
  { to: "/", label: "Reservations", disabled: true },
  { to: "/", label: "Guests", disabled: true },
  { to: "/", label: "Rooms & Rates", disabled: true },
  { to: "/", label: "Housekeeping", disabled: true },
  { to: "/", label: "Folios & AR", disabled: true },
  { to: "/", label: "Reports", disabled: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const sessionQuery = useSessionMe();
  const signOut = useSignOut();

  // Clean the launch URL if it still shows ?token= after Path A redirect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("token")) {
      params.delete("token");
      const clean = window.location.pathname + (params.size ? "?" + params.toString() : "");
      window.history.replaceState({}, "", clean);
    }
  }, []);

  if (sessionQuery.isLoading) {
    return <FullScreenLoader label="Loading session…" />;
  }

  const session = sessionQuery.data;
  if (!session || session.authenticated === false) {
    return <UnauthenticatedGate devConnectAvailable={session?.devConnectAvailable ?? false} />;
  }

  const role = session.role;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold">
              H
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">HotelHub</div>
              <div className="text-xs text-muted-foreground leading-tight">
                Boutique Hotel System · N3 integration
              </div>
            </div>
          </div>
          <SessionBadge
            session={session}
            onSignOut={() => signOut.mutate()}
            signingOut={signOut.isPending}
          />
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <nav aria-label="Primary" className="w-56 shrink-0">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item, i) => {
              const active = !item.disabled && location.pathname === item.to;
              const visible = !item.permission || hasPermission(role, item.permission);
              if (item.disabled || !visible) {
                const title = item.disabled
                  ? "Deferred MAF milestone"
                  : "Not available for your role";
                return (
                  <li key={`${item.label}-${i}`}>
                    <span
                      className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed"
                      title={title}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] uppercase tracking-wide">
                        {item.disabled ? "soon" : "locked"}
                      </span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={`${item.label}-${i}`}>
                  <Link
                    to={item.to}
                    className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          {session.roleStatus === "role_unassigned" ? (
            <RoleUnassignedBanner session={session} />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function RoleUnassignedBanner({
  session,
}: {
  session: Extract<SessionMe, { authenticated: true }>;
}) {
  return (
    <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-semibold">HotelHub role not assigned</p>
      <p className="mt-1 text-muted-foreground">
        Your N3 identity has been verified for tenant{" "}
        <span className="font-mono">
          {session.tenant.tenantCode ?? session.tenant.companyName ?? "—"}
        </span>
        , but no HotelHub role (<code>owner</code>, <code>front_desk</code>, or{" "}
        <code>housekeeper</code>) is assigned yet. All hotel features are denied by default until a
        role is granted.
      </p>
    </div>
  );
}

function SessionBadge({
  session,
  onSignOut,
  signingOut,
}: {
  session: Extract<SessionMe, { authenticated: true }>;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <dl className="grid grid-cols-4 gap-x-4 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Company</dt>
        <dt className="text-muted-foreground">Tenant</dt>
        <dt className="text-muted-foreground">User</dt>
        <dt className="text-muted-foreground">Role</dt>
        <dd
          className="font-medium text-foreground truncate max-w-[160px]"
          title={session.tenant.companyName ?? undefined}
        >
          {session.tenant.companyName ?? "—"}
        </dd>
        <dd
          className="font-medium text-foreground truncate max-w-[120px]"
          title={session.tenant.tenantCode ?? undefined}
        >
          {session.tenant.tenantCode ?? "—"}
        </dd>
        <dd
          className="font-medium text-foreground truncate max-w-[180px]"
          title={session.user.userEmail ?? session.user.userName ?? undefined}
        >
          {session.user.userEmail ?? session.user.userName ?? "—"}
        </dd>
        <dd className="font-medium text-foreground truncate max-w-[120px]">
          {session.role ?? <span className="text-amber-500">unassigned</span>}
        </dd>
      </dl>
      <button
        onClick={onSignOut}
        disabled={signingOut}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function UnauthenticatedGate({ devConnectAvailable }: { devConnectAvailable: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold">
            H
          </div>
          <h1 className="text-lg font-semibold">HotelHub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Boutique Hotel System — N3 AI Cloud Accounting
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Sign in from N3</p>
          <p className="mt-1 text-muted-foreground">
            Open this app from <strong>N3 → Marketplace → My Apps → Open</strong>. N3 will hand off
            a secure launch token to the server; the browser never sees it.
          </p>
        </div>
        {devConnectAvailable ? <DevApiKeyLogin /> : null}
      </div>
    </div>
  );
}

function DevApiKeyLogin() {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const connect = useDevConnect();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await connect.mutateAsync(apiKey.trim());
      setApiKey("");
    } catch {
      /* handled via connect.error */
    }
  }

  if (!open) {
    return (
      <div className="mt-4 text-center">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Developer sign-in
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 rounded-md border border-dashed border-border p-4"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Development only — API key sign-in
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Disabled in production. The key is exchanged server-side, immediately verified against N3,
          and stored only inside the HttpOnly session cookie. It is never persisted, logged, or
          returned to the browser.
        </p>
      </div>
      <input
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="N3 API key"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        required
      />
      {connect.error ? (
        <p className="text-xs text-destructive">{(connect.error as Error).message}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1.5 text-xs hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={connect.isPending || !apiKey.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {connect.isPending ? "Connecting…" : "Connect with API key"}
        </button>
      </div>
    </form>
  );
}
