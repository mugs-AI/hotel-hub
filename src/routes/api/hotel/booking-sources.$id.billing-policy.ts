import { createFileRoute } from "@tanstack/react-router";
import { handleSourcePolicyHttp } from "@/lib/source-policy-http.server";
import { liveSourcePolicyHttpDeps } from "@/lib/source-policy-adapter.server";
export const Route = createFileRoute("/api/hotel/booking-sources/$id/billing-policy")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSourcePolicyHttp("policy_read", request, params.id ?? "", liveSourcePolicyHttpDeps()),
      POST: ({ request, params }) =>
        handleSourcePolicyHttp("policy_save", request, params.id ?? "", liveSourcePolicyHttpDeps()),
    },
  },
});
