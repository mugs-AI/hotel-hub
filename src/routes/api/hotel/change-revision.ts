import { createFileRoute } from "@tanstack/react-router";
import { json, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { readChangeRevision } from "@/lib/hotel-change-revision.server";
export const Route = createFileRoute("/api/hotel/change-revision")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const revision = await readChangeRevision(actor.tenantId);
          return json({ available: revision !== null, revision });
        }),
    },
  },
});
