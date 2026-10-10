import { createFileRoute } from "@tanstack/react-router";
import { json, withReceiptActor } from "@/lib/receipt-controls-http.server";
import { listBillToChanges } from "@/lib/folio-bill-to-controls.server";
export const Route = createFileRoute("/api/hotel/bill-to-changes")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const url = new URL(request.url);
          return json(
            await listBillToChanges(
              actor,
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 50),
            ),
          );
        }),
    },
  },
});
