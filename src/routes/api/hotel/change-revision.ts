import { createFileRoute } from "@tanstack/react-router";
import { json, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { readChangeRevision } from "@/lib/hotel-change-revision.server";
export const Route = createFileRoute("/api/hotel/change-revision")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const revision = await readChangeRevision(actor.tenantId);
          const { readDepositNotices } = await import("@/lib/deposit-notifications.server");
          const notification =
            revision === null
              ? null
              : await readDepositNotices(actor, new URL(request.url).searchParams.get("after"));
          return json({ available: revision !== null, revision, notification });
        }),
    },
  },
});
