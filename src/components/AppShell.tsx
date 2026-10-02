import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useSessionMe, useSignOut, useDevConnect, type SessionMe } from "@/lib/session-client";
import { hasPermission, type Permission } from "@/lib/rbac";
import { housekeepingAuthority } from "@/lib/housekeeping";
import { roleUnassignedGuidance } from "@/lib/role-unassigned";

import { useDisplayWidth, widthContainerClass } from "@/lib/display-preference";
import { applyDisplaySize, coerceDisplaySize } from "@/lib/display-size";
import { ChevronDown, Menu } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WorkTabs } from "@/components/WorkTabs";

export function hotelRoleLabel(role: string | null) {
  return role === "owner"
    ? "Owner"
    : role === "front_desk"
      ? "Front Desk"
      : role === "housekeeper"
        ? "Housekeeper"
        : "Staff";
}

type NavItem = {
  to:
    | "/"
    | "/verification"
    | "/rooms-rates"
    | "/reservations"
    | "/settings"
    | "/departures"
    | "/housekeeping"
    | "/receipt-reports";
  label: string;
  permission?: Permission;
  disabled?: boolean;
  matchPrefix?: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", permission: "app:view" },
  {
    to: "/reservations",
    label: "Reservations",
    permission: "hotel:reservations:view",
    matchPrefix: "/reservations",
  },
  { to: "/departures", label: "Departures", permission: "hotel:checkout:view" },
  {
    to: "/housekeeping",
    label: "Housekeeping",
    permission: "hotel:housekeeping:view",
  },
  { to: "/rooms-rates", label: "Rooms & Rates", permission: "hotel:rooms:view" },

  { to: "/settings", label: "Settings", permission: "hotel:setup", matchPrefix: "/settings" },
  {
    to: "/receipt-reports",
    label: "Receipt reports",
    permission: "hotel:financial_reports:view",
  },
  // Deferred MAF milestones — placeholders only.
  { to: "/", label: "Guests", disabled: true },
  { to: "/", label: "Folios & AR", disabled: true },
  { to: "/", label: "Reports", disabled: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const sessionQuery = useSessionMe();
  const signOut = useSignOut();
  const [displayWidth, setDisplayWidth] = useDisplayWidth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [companySyncState, setCompanySyncState] = useState<"idle" | "syncing" | "failed">("idle");
  const attemptedCompanyTenant = useRef<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);

  // Property-wide display size. The authoritative value arrives with the
  // session, so a confirmed Owner save applies as soon as the session cache
  // refreshes — no hard refresh, no sign-out.
  const sessionData = sessionQuery.data;
  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const measure = () =>
      shellRef.current?.style.setProperty(
        "--hh-navigation-height",
        `${navigation.getBoundingClientRect().height}px`,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [sessionData?.authenticated]);
  const refetchSession = sessionQuery.refetch;
  const refreshCompanyName = useCallback(async () => {
    setCompanySyncState("syncing");
    try {
      const res = await fetch("/api/hotel/company-name/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("company_name_refresh_failed");
      await refetchSession();
      setCompanySyncState("idle");
    } catch {
      setCompanySyncState("failed");
    }
  }, [refetchSession]);

  // Only the N3 Owner may read Company Profile. This optional background
  // refresh never delays the neutral launch or a staff member's page load.
  useEffect(() => {
    if (
      sessionData?.authenticated !== true ||
      sessionData.role !== "owner" ||
      (sessionData.tenant.companyName && sessionData.user.userName) ||
      attemptedCompanyTenant.current === sessionData.tenant.tenantId
    )
      return;
    attemptedCompanyTenant.current = sessionData.tenant.tenantId;
    void refreshCompanyName();
  }, [sessionData, refreshCompanyName]);
  const displaySize =
    sessionData && sessionData.authenticated === true
      ? coerceDisplaySize(sessionData.displaySize)
      : 7;
  useEffect(() => {
    applyDisplaySize(typeof document === "undefined" ? undefined : document, displaySize);
  }, [displaySize]);

  // Note: the N3 launch token is consumed server-side by the root-URL
  // interceptor in `src/start.ts` and the `/api/auth/launch` handler, then
  // stripped via a 302 redirect. Client code never sees the token, so no
  // browser-side URL cleanup is performed here.

  if (sessionQuery.isLoading) {
    return <FullScreenLoader label="Loading session…" />;
  }

  const session = sessionQuery.data;
  if (!session || session.authenticated === false) {
    return <UnauthenticatedGate devConnectAvailable={session?.devConnectAvailable ?? false} />;
  }

  // Enforce the RBAC gate at the shell: role-unassigned / inactive users
  // never render authenticated page content or navigation, only the
  // provisioning banner.
  if (session.roleStatus === "role_unassigned" || session.role === null) {
    return (
      <RoleUnassignedShell
        session={session}
        onSignOut={() => signOut.mutate()}
        signingOut={signOut.isPending}
        onRetry={() => void sessionQuery.refetch()}
      />
    );
  }

  const role = session.role;
  // Mode authority: Housekeeping is a normal workspace for anyone the server
  // lets view the board. A housekeeper in simple mode still has no access.
  const hkAuthority = housekeepingAuthority(session.housekeepingMode ?? "simple", role);
  const containerClass = widthContainerClass(displayWidth);

  const renderLink = (item: NavItem) => {
    const visible =
      item.to === "/housekeeping"
        ? hkAuthority.canOpenWorkspace
        : !item.permission || hasPermission(role, item.permission);
    if (!visible) return null;
    const path = location.pathname;
    const active =
      path === item.to || Boolean(item.matchPrefix && path.startsWith(item.matchPrefix + "/"));
    return (
      <Link
        key={item.label}
        to={item.to}
        onClick={() => setMenuOpen(false)}
        aria-current={active ? "page" : undefined}
        className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-[#0F9D8A] text-white" : "text-[#102A43] hover:bg-muted"}`}
      >
        {item.label}
      </Link>
    );
  };
  const isTool = (item: NavItem) => item.to === "/rooms-rates" || item.to === "/settings" || item.to === "/receipt-reports";
  const navigationLinks = NAV_ITEMS.filter((item) => !item.disabled && !isTool(item)).map(
    renderLink,
  );
  const toolLinks = NAV_ITEMS.filter((item) => !item.disabled && isTool(item)).map(renderLink);
  const tools = (
    <details
      key={location.pathname}
      className="group relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-[#102A43] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        Tools <ChevronDown className="h-4 w-4" aria-hidden />
      </summary>
      <div className="z-50 w-full rounded-md border bg-white p-2 shadow-lg xl:absolute xl:right-0 xl:w-52">
        {toolLinks}
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border-t px-3 py-2 text-sm font-medium text-[#102A43] hover:bg-muted">
          Full Width
          <input
            type="checkbox"
            checked={displayWidth === "full"}
            onChange={(event) => setDisplayWidth(event.target.checked ? "full" : "standard")}
            className="h-4 w-4 accent-[#0F9D8A]"
          />
        </label>
      </div>
    </details>
  );

  return (
    <div
      ref={shellRef}
      className="min-h-screen text-foreground"
      style={{ backgroundColor: "#F4F8FC" }}
    >
      <div ref={navigationRef} data-testid="fixed-workspace-bars" className="sticky top-0 z-40">
        <header className="border-b border-border bg-white">
          <div className={`${containerClass} flex min-w-0 items-center justify-between gap-2 py-2`}>
            <div className="flex shrink-0 items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md font-semibold text-white"
                style={{ backgroundColor: "#102A43" }}
              >
                H
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight" style={{ color: "#102A43" }}>
                  HotelHub
                </div>
              </div>
            </div>
            <nav
              aria-label="Primary"
              className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex"
            >
              {navigationLinks}
              {tools}
            </nav>
            <div className="flex min-w-0 items-center gap-2">
              <SessionBadge
                session={session}
                onSignOut={() => signOut.mutate()}
                signingOut={signOut.isPending}
                onRefreshCompany={() => void refreshCompanyName()}
                companySyncState={companySyncState}
              />
              <Popover key={location.pathname} open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open main menu"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input text-[#102A43] focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
                  >
                    <Menu className="h-5 w-5" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
                  onEscapeKeyDown={(event) => {
                    const details =
                      event.target instanceof HTMLElement
                        ? event.target.closest("details[open]")
                        : null;
                    if (details) {
                      event.preventDefault();
                      details.removeAttribute("open");
                      details.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <nav aria-label="Mobile primary">
                    {navigationLinks}
                    {tools}
                  </nav>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </header>
        <WorkTabs width={displayWidth} />
      </div>
      <div className={`${containerClass} min-w-0 py-4 sm:py-6`}>
        <main className="min-w-0">{children}</main>
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

/**
 * Full-page gate shown to authenticated N3 users who have no effective
 * HotelHub role. Replaces the entire application shell — no navigation, no
 * dashboard, no verification console.
 *
 * WHAT it says depends on the safe `roleReason` from the server: a revoked
 * ex-Owner, an unconfirmable ownership read, an inactive/unmatched N3 user
 * and a genuine first-Owner bootstrap are four different situations, and only
 * the last one may show the provisioning runbook.
 */
export function RoleUnassignedShell({
  session,
  onSignOut,
  signingOut,
  onRetry,
}: {
  session: Extract<SessionMe, { authenticated: true }>;
  onSignOut: () => void;
  signingOut: boolean;
  onRetry?: () => void;
}) {
  const guidance = roleUnassignedGuidance(session.roleReason ?? null);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 p-6">
        <p className="text-sm font-semibold">{guidance.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{guidance.body}</p>
        {guidance.showIdentifiers && (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md bg-background/60 p-4 text-xs sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Company</dt>
            <dd className="font-mono break-all">{session.tenant.companyName ?? "—"}</dd>
            <dt className="text-muted-foreground">Tenant code</dt>
            <dd className="font-mono break-all">{session.tenant.tenantCode ?? "—"}</dd>
            <dt className="text-muted-foreground">hotel_tenants.id</dt>
            <dd className="font-mono break-all">{session.tenant.tenantId}</dd>
            <dt className="text-muted-foreground">n3_user_key</dt>
            <dd className="font-mono break-all">{session.user.n3UserKey}</dd>
            <dt className="text-muted-foreground">User email</dt>
            <dd className="font-mono break-all">{session.user.userEmail ?? "—"}</dd>
          </dl>
        )}
        {guidance.showIdentifiers && (
          <p className="mt-4 text-xs text-muted-foreground">
            Provide these identifiers to the current N3 Owner or your MUGS administrator when asking
            for HotelHub access. No action is required from you here.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {guidance.showRetry && onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Try again
            </button>
          )}
          <button
            onClick={onSignOut}
            disabled={signingOut}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionBadge({
  session,
  onSignOut,
  signingOut,
  onRefreshCompany,
  companySyncState,
}: {
  session: Extract<SessionMe, { authenticated: true }>;
  onSignOut: () => void;
  signingOut: boolean;
  onRefreshCompany: () => void;
  companySyncState: "idle" | "syncing" | "failed";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Account information"
            className="flex min-w-0 items-center gap-1 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="max-w-[7rem] truncate sm:max-w-[10rem]">
              {session.user.userName ?? "Account"}
            </span>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              {hotelRoleLabel(session.role)}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
          <div className="break-words font-semibold">
            {session.tenant.companyName ?? "Company name unavailable"}
          </div>
          <div className="break-words">
            {session.user.userName ?? "User name unavailable"} · {session.role}
          </div>
          <div className="break-all text-xs text-muted-foreground">
            {session.user.userEmail ?? "—"}
          </div>
          <div className="break-all text-xs text-muted-foreground">
            Tenant ID: {session.tenant.tenantCode ?? "—"}
          </div>
          {session.role === "owner" && (!session.tenant.companyName || !session.user.userName) ? (
            <button
              type="button"
              onClick={onRefreshCompany}
              disabled={companySyncState === "syncing"}
              className="text-sm underline disabled:opacity-50"
            >
              {companySyncState === "syncing" ? "Syncing N3 name…" : "Sync N3 name"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="block rounded-md border border-input px-3 py-2 text-sm disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </PopoverContent>
      </Popover>
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
