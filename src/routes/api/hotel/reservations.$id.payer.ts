import { createFileRoute } from "@tanstack/react-router";
import { handleSourcePolicyHttp } from "@/lib/source-policy-http.server";
import { liveSourcePolicyHttpDeps } from "@/lib/source-policy-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/payer")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSourcePolicyHttp("payer_read", request, params.id ?? "", liveSourcePolicyHttpDeps()),
      POST: ({ request, params }) =>
        handleSourcePolicyHttp("payer_save", request, params.id ?? "", liveSourcePolicyHttpDeps()),
    },
  },
});
