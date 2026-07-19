import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { probe as runProbe, useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "N3 Verification Console — HotelHub" },
      {
        name: "description",
        content: "Owner-only read-only probes against the three allowlisted N3 endpoints.",
      },
    ],
  }),
  component: VerificationConsolePage,
});

type ProbeItem = { name: string; label: string; description: string };

type ProbeState = {
  loading: boolean;
  httpStatus: number | null;
  upstreamStatus: number | null;
  durationMs: number | null;
  body: string;
  error: string | null;
};

const INITIAL: ProbeState = {
  loading: false,
  httpStatus: null,
  upstreamStatus: null,
  durationMs: null,
  body: "",
  error: null,
};

function VerificationConsolePage() {
  const session = useSessionMe();
  const [probes, setProbes] = useState<ProbeItem[]>([]);
  const [state, setState] = useState<Record<string, ProbeState>>({});

  const authenticated = session.data && session.data.authenticated === true ? session.data : null;
  const canVerify = authenticated ? hasPermission(authenticated.role, "n3:verify") : false;

  useEffect(() => {
    if (!canVerify) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/n3/probe", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { probes: ProbeItem[] };
        if (!cancelled) setProbes(body.probes);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canVerify]);

  async function run(name: string) {
    setState((s) => ({ ...s, [name]: { ...INITIAL, loading: true } }));
    try {
      const result = await runProbe(name);
      let pretty = "";
      try {
        pretty = JSON.stringify(result.body, null, 2);
      } catch {
        pretty = String(result.body);
      }
      setState((s) => ({
        ...s,
        [name]: {
          loading: false,
          httpStatus: result.httpStatus,
          upstreamStatus: result.status,
          durationMs: result.durationMs,
          body: pretty,
          error: result.error ?? null,
        },
      }));
      if (result.httpStatus === 401) {
        // N3 401 destroyed the session server-side; refresh the shell.
        session.refetch();
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        [name]: {
          ...INITIAL,
          error: err instanceof Error ? err.message : "Request failed",
        },
      }));
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">N3 Verification Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Owner-only. Runs the three fixed read-only probes through the server-side gateway. No
            custom paths, no writes, no arbitrary endpoints.
          </p>
        </div>

        {!canVerify ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold">Access denied</p>
            <p className="mt-1 text-muted-foreground">
              The N3 Verification Console is restricted to the <code>owner</code> role. Housekeeping
              and front-desk staff must not have access to accounting integration health data.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {probes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading probes…</p>
            ) : null}
            {probes.map((probe) => {
              const s = state[probe.name] ?? INITIAL;
              return (
                <div key={probe.name} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{probe.label}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{probe.description}</p>
                    </div>
                    <button
                      onClick={() => run(probe.name)}
                      disabled={s.loading}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {s.loading ? "Running…" : "Run probe"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>
                      Gateway:{" "}
                      <span className="font-mono text-foreground">{s.httpStatus ?? "—"}</span>
                    </span>
                    <span>
                      N3 upstream:{" "}
                      <span className="font-mono text-foreground">{s.upstreamStatus ?? "—"}</span>
                    </span>
                    <span>
                      Duration:{" "}
                      <span className="font-mono text-foreground">
                        {s.durationMs !== null ? `${s.durationMs} ms` : "—"}
                      </span>
                    </span>
                  </div>
                  {s.error ? (
                    <p className="mt-2 text-sm text-destructive">
                      {s.error === "n3_unauthorized"
                        ? "N3 returned 401 — your session has been terminated."
                        : `Error: ${s.error}`}
                    </p>
                  ) : null}
                  {s.body ? (
                    <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                      {s.body}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
