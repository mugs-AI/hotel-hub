import { createFileRoute } from "@tanstack/react-router";
import { handleSourceBillingHttp } from "@/lib/source-billing-http.server";
import { liveSourceBillingHttpDeps } from "@/lib/source-billing-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/source-billing")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSourceBillingHttp("read", request, params.id ?? "", liveSourceBillingHttpDeps()),
    },
  },
});
