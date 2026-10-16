import { createFileRoute } from "@tanstack/react-router";
import { handleSourceBillingHttp } from "@/lib/source-billing-http.server";
import { liveSourceBillingHttpDeps } from "@/lib/source-billing-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/source-billing/confirm")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleSourceBillingHttp("confirm", request, params.id ?? "", liveSourceBillingHttpDeps()),
    },
  },
});
