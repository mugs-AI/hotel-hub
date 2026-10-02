// GET /api/hotel/receipt-controls?reservationId=&queue=1&offset=&limit=
// Server-paged (max 100 per page) with an exact total; never silently capped.
// Owner sees all requests; Front Desk sees only its own.
import { createFileRoute } from "@tanstack/react-router";
import { json, withReceiptActor } from "@/lib/receipt-controls-http.server";

export const Route = createFileRoute("/api/hotel/receipt-controls")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const url = new URL(request.url);
          const { listReceiptControlRequests } =
            await import("@/lib/receipt-controls-store.server");
          const { defaultReceiptControlDeps } = await import("@/lib/receipt-controls-deps.server");
          const page = await listReceiptControlRequests(
            actor,
            {
              reservationId: url.searchParams.get("reservationId") ?? undefined,
              queue: url.searchParams.get("queue") === "1",
              offset: url.searchParams.get("offset") ?? undefined,
              limit: url.searchParams.get("limit") ?? undefined,
            },
            defaultReceiptControlDeps(),
          );
          return json({ ...page, transport: { configured: false } });
        }),
    },
  },
});
