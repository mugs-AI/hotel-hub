// GET /api/n3/probe — advertise which probes exist. Requires authenticated
// session; role does not need to be n3:verify (this list is metadata only).
import { createFileRoute } from "@tanstack/react-router";
import { readRequestContext } from "@/lib/session-context.server";
import { listProbes } from "@/lib/n3-gateway.server";

export const Route = createFileRoute("/api/n3/probe/")({
  server: {
    handlers: {
      GET: async () => {
        const ctx = await readRequestContext();
        if (!ctx.authenticated) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        return Response.json(
          { probes: listProbes() },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
