import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  clearStoredToken,
  decodeJwtClaims,
  getStoredToken,
  setStoredToken,
  unwrapApiResponse,
} from "@/lib/qne-auth";
import { qneJson, QneAuthError } from "@/lib/qne-client";

type SessionCtx = {
  company: string | null;
  tenantCode: string | null;
  email: string | null;
  loading: boolean;
  error: string | null;
};

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/verification", label: "N3 Verification Console" },
  // Deferred MAF milestones — placeholders only; no business logic yet.
  { to: "/reservations", label: "Reservations", disabled: true },
  { to: "/guests", label: "Guests", disabled: true },
  { to: "/rooms", label: "Rooms & Rates", disabled: true },
  { to: "/housekeeping", label: "Housekeeping", disabled: true },
  { to: "/folios", label: "Folios & AR", disabled: true },
  { to: "/reports", label: "Reports", disabled: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [session, setSession] = useState<SessionCtx>({
    company: null,
    tenantCode: null,
    email: null,
    loading: false,
    error: null,
  });

  // Path A: read ?token= from URL, persist, then strip from address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setStoredToken(urlToken);
      setToken(urlToken);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Always re-fetch company/tenant/email from N3 on every authenticated load.
  // Never read these from browser storage — cache would go stale after a
  // company switch or profile edit.
  useEffect(() => {
    if (!token) {
      setSession({ company: null, tenantCode: null, email: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setSession((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const envelope = await qneJson<{ code: string; data: unknown; message?: string }>(
          "main",
          "/api/companyprofile/BasicInfo",
        );
        const data = unwrapApiResponse<Record<string, unknown>>(envelope);
        const claims = decodeJwtClaims(token) ?? {};
        if (cancelled) return;
        setSession({
          company:
            (data?.companyName as string | undefined) ??
            (data?.company as string | undefined) ??
            null,
          tenantCode:
            (data?.tenantCode as string | undefined) ??
            (claims.tenantCode as string | undefined) ??
            null,
          email:
            (data?.email as string | undefined) ??
            (claims.email as string | undefined) ??
            (claims.name as string | undefined) ??
            null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof QneAuthError && err.status === 401) {
          setToken(null);
          setSession({ company: null, tenantCode: null, email: null, loading: false, error: null });
          return;
        }
        setSession({
          company: null,
          tenantCode: null,
          email: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load session",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleSignOut() {
    clearStoredToken();
    setToken(null);
    navigate({ to: "/" });
  }

  if (!token) {
    return <UnauthenticatedGate onToken={setToken} />;
  }

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
          <SessionBadge session={session} onSignOut={handleSignOut} />
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <nav aria-label="Primary" className="w-56 shrink-0">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.to;
              if (item.disabled) {
                return (
                  <li key={item.label}>
                    <span
                      className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed"
                      title="Deferred MAF milestone"
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] uppercase tracking-wide">soon</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.label}>
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
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function SessionBadge({
  session,
  onSignOut,
}: {
  session: SessionCtx;
  onSignOut: () => void;
}) {
  const placeholder = session.loading ? "…" : "—";
  return (
    <div className="flex items-center gap-4">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Company</dt>
        <dt className="text-muted-foreground">Tenant</dt>
        <dt className="text-muted-foreground">User</dt>
        <dd className="font-medium text-foreground truncate max-w-[160px]" title={session.company ?? undefined}>
          {session.company ?? placeholder}
        </dd>
        <dd className="font-medium text-foreground truncate max-w-[120px]" title={session.tenantCode ?? undefined}>
          {session.tenantCode ?? placeholder}
        </dd>
        <dd className="font-medium text-foreground truncate max-w-[180px]" title={session.email ?? undefined}>
          {session.email ?? placeholder}
        </dd>
      </dl>
      <button
        onClick={onSignOut}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Sign out
      </button>
    </div>
  );
}

function UnauthenticatedGate({ onToken }: { onToken: (t: string) => void }) {
  // In production the ONLY entry point is Path A (?token= from My Apps).
  // Path B (API-key form) is stripped from production bundles via
  // import.meta.env.PROD dead-code elimination.
  const isDev = import.meta.env.DEV;

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
            Open this app from <strong>N3 → Marketplace → My Apps → Open</strong>. N3
            will pass a secure session token in the URL.
          </p>
        </div>
        {isDev ? <DevApiKeyLogin onToken={onToken} /> : null}
      </div>
    </div>
  );
}

function DevApiKeyLogin({ onToken }: { onToken: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        expiration?: string;
        error?: string;
      };
      if (!res.ok || !body.token) {
        throw new Error(body.error ?? `Connect failed (${res.status})`);
      }
      setStoredToken(body.token, body.expiration);
      setApiKey("");
      onToken(body.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-md border border-dashed border-border p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Development only — API key login
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Stripped from production builds. The key is exchanged server-side and
          never stored or logged.
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
          disabled={busy || !apiKey.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect with API key"}
        </button>
      </div>
    </form>
  );
}
