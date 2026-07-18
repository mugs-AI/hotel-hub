import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { qneFetch } from "@/lib/qne-client";

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "N3 Verification Console — HotelHub" },
      {
        name: "description",
        content:
          "Probe N3 AI Cloud Accounting Open API endpoints and inspect raw responses.",
      },
    ],
  }),
  component: VerificationConsole,
});

type ProbeState = {
  status: number | null;
  body: string;
  loading: boolean;
  error: string | null;
  durationMs: number | null;
};

const INITIAL: ProbeState = {
  status: null,
  body: "",
  loading: false,
  error: null,
  durationMs: null,
};

// A short list of read-only endpoints the brief calls out for capability
// verification. Kept as GET-only, no writes — this console must never post
// data to N3.
const PRESETS: Array<{ label: string; host: "main" | "reporting"; path: string; note?: string }> = [
  { label: "Company profile (BasicInfo)", host: "main", path: "/api/companyprofile/BasicInfo" },
  { label: "Company profile (full)", host: "main", path: "/api/companyprofile" },
  { label: "Customers — list (top 5)", host: "main", path: "/api/customers/list?$top=5&$skip=0" },
  { label: "Stock codes — list (top 5)", host: "main", path: "/api/stocks/list?$top=5&$skip=0" },
];

export function VerificationConsole() {
  const [host, setHost] = useState<"main" | "reporting">("main");
  const [path, setPath] = useState<string>(PRESETS[0].path);
  const [state, setState] = useState<ProbeState>(INITIAL);

  async function run() {
    setState({ ...INITIAL, loading: true });
    const started = performance.now();
    try {
      const res = await qneFetch(host, path, { method: "GET" });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* leave as-is */
      }
      setState({
        status: res.status,
        body: pretty,
        loading: false,
        error: null,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      setState({
        status: null,
        body: "",
        loading: false,
        error: err instanceof Error ? err.message : "Request failed",
        durationMs: Math.round(performance.now() - started),
      });
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">N3 Verification Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only probes against the N3 Open API through the same-origin
            backend proxy. Use to confirm official endpoint availability before
            wiring business modules.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setHost(p.host);
                  setPath(p.path);
                }}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-accent"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr_auto]">
            <select
              value={host}
              onChange={(e) => setHost(e.target.value as "main" | "reporting")}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="main">main</option>
              <option value="reporting">reporting</option>
            </select>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/companyprofile/BasicInfo"
              className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={run}
              disabled={state.loading || !path.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {state.loading ? "Running…" : "Send GET"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Status: <span className="font-mono text-foreground">{state.status ?? "—"}</span>
            </span>
            <span>
              Duration:{" "}
              <span className="font-mono text-foreground">
                {state.durationMs !== null ? `${state.durationMs} ms` : "—"}
              </span>
            </span>
          </div>
          {state.error ? (
            <p className="mt-2 text-sm text-destructive">{state.error}</p>
          ) : null}
          <pre className="mt-3 max-h-[520px] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            {state.body || (state.loading ? "" : "// response will appear here")}
          </pre>
        </div>
      </div>
    </AppShell>
  );
}
