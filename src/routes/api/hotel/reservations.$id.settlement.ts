import { createFileRoute } from "@tanstack/react-router";
import { handleSettlementHttp } from "@/lib/settlement-http.server";
import { liveSettlementHttpDeps } from "@/lib/settlement-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/settlement")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSettlementHttp("read", request, params.id ?? "", liveSettlementHttpDeps()),
    },
  },
});
