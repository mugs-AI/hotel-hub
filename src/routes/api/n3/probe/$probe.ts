// GET /api/n3/probe/:name — deny-by-default gateway.
// Only three fixed probes are permitted; only GET; only for authenticated
// sessions with the `n3:verify` permission (owner).
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import { isProbeName, listProbes, runProbe } from "@/lib/n3-gateway.server";
import { logAudit } from "@/lib/audit.server";

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET" },
  });
}

async function handle({
  request,
  params,
}: {
  request: Request;
  params: { probe?: string };
}) {
  const method = request.method.toUpperCase();
  if (method !== "GET") return methodNotAllowed();

  const probeName = params.probe ?? "";
  if (!isProbeName(probeName)) {
    await logAudit({
      eventType: "probe.denied",
      detail: { reason: "unknown_probe", probe: probeName.slice(0, 60) },
    });
    return Response.json(
      { error: "Unknown probe", allowed: listProbes().map((p) => p.name) },
      { status: 403 },
    );
  }

  const { ctx, decision } = await requirePermission("n3:verify");
  if (!decision.ok) {
    if (decision.reason === "unauthenticated") {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }
    return Response.json({ error: decision.reason }, { status: 403 });
  }

  try {
    const result = await runProbe(ctx.session.n3Token, probeName);
    if (result.status === 401) {
      await destroySession("n3_401");
      await logAudit({
        tenantId: ctx.session.tenantId,
        n3UserKey: ctx.session.n3UserKey,
        eventType: "session.n3_401",
        detail: { probe: probeName },
      });
      return Response.json(
        { error: "n3_unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "probe.executed",
      detail: { probe: probeName, status: result.status, durationMs: result.durationMs },
    });
    return Response.json(
      {
        probe: probeName,
        status: result.status,
        durationMs: result.durationMs,
        // Return the sanitized upstream body (already JSON-parsed when possible).
        body: result.body,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[probe] failed", (err as Error).message);
    // Never leak upstream error text.
    return Response.json(
      { error: "probe_failed", probe: probeName },
      { status: 502 },
    );
  }
}

export const Route = createFileRoute("/api/n3/probe/$probe")({
  server: {
    handlers: {
      GET: handle,
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
