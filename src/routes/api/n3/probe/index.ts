// GET /api/n3/probe — advertise which probes exist.
// Metadata is treated as sensitive: it requires the same `n3:verify`
// permission as probe execution. Authenticated non-Owner sessions receive 403.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { listProbes } from "@/lib/n3-gateway.server";

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET" },
  });
}

export async function handleProbeMetadata(): Promise<Response> {
  const { decision } = await requirePermission("n3:verify");
  if (!decision.ok) {
    const status = decision.reason === "unauthenticated" ? 401 : 403;
    return Response.json(
      { error: decision.reason },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json({ probes: listProbes() }, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/n3/probe/")({
  server: {
    handlers: {
      GET: handleProbeMetadata,
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
