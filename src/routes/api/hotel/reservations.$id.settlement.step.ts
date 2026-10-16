import { createFileRoute } from "@tanstack/react-router";
import { handleSettlementHttp } from "@/lib/settlement-http.server";
import { liveSettlementHttpDeps } from "@/lib/settlement-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/settlement/step")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleSettlementHttp("step", request, params.id ?? "", liveSettlementHttpDeps()),
    },
  },
});
