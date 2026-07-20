// GET /api/n3/probe/:name — deny-by-default gateway.
// Only three fixed probes are permitted; only GET; only for authenticated
// sessions with the `n3:verify` permission (owner).
//
// Ordering matters: authorization runs FIRST, before any probe-name
// validation or allowlist disclosure. Unauthenticated / non-Owner callers
// therefore never learn which probe names exist.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import { isProbeName, runProbe } from "@/lib/n3-gateway.server";
import { logAudit } from "@/lib/audit.server";

const MAX_PROBE_BODY_BYTES = 128 * 1024; // 128 KB — safe upper bound for BasicInfo/top-5 lists.

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET" },
  });
}

/** Reduce arbitrary upstream bodies to a safe, bounded shape. */
function sanitizeUpstream(status: number, body: unknown): {
  kind: "json" | "non_json" | "truncated" | "empty";
  body: unknown;
} {
  if (body === null || body === undefined || body === "") {
    return { kind: "empty", body: null };
  }
  if (typeof body === "string") {
    // Upstream returned raw text (HTML error page, stack trace, credentials
    // echoed back, etc). Never forward it to the browser.
    return { kind: "non_json", body: { note: "upstream_returned_non_json", status } };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return { kind: "non_json", body: { note: "upstream_unserializable", status } };
  }
  if (serialized.length > MAX_PROBE_BODY_BYTES) {
    return {
      kind: "truncated",
      body: { note: "upstream_body_too_large", bytes: serialized.length, status },
    };
  }
  return { kind: "json", body };
}

export async function handleProbeExecute({
  request,
  params,
}: {
  request: Request;
  params: { probe?: string };
}): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET") return methodNotAllowed();

  // 1) Authorize first. This must run BEFORE we inspect the probe name so
  //    unauthenticated / non-Owner callers can't fingerprint the allowlist.
  const { ctx, decision } = await requirePermission("n3:verify");
  if (!decision.ok) {
    if (decision.reason === "unauthenticated") {
      return Response.json(
        { error: "unauthenticated" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { error: decision.reason },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  // 2) Now that the caller is an authorized Owner, validate the probe name.
  const probeName = params.probe ?? "";
  if (!isProbeName(probeName)) {
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "probe.denied",
      detail: { reason: "unknown_probe", probe: probeName.slice(0, 60) },
    });
    return Response.json(
      { error: "unknown_probe" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
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
    const sanitized = sanitizeUpstream(result.status, result.body);
    const isSuccess = result.status >= 200 && result.status < 300;
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "probe.executed",
      detail: {
        probe: probeName,
        status: result.status,
        durationMs: result.durationMs,
        bodyKind: sanitized.kind,
      },
    });
    return Response.json(
      {
        probe: probeName,
        status: result.status,
        durationMs: result.durationMs,
        // For non-success upstream responses we return only safe metadata,
        // never raw HTML / stack traces / credentials / cookies.
        body: isSuccess ? sanitized.body : { note: `upstream_status_${result.status}` },
        bodyKind: sanitized.kind,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[probe] failed", (err as Error).message?.slice(0, 200));
    return Response.json(
      { error: "probe_failed", probe: probeName },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/n3/probe/$probe")({
  server: {
    handlers: {
      GET: handleProbeExecute,
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
