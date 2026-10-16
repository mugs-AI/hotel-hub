import { createFileRoute } from "@tanstack/react-router";
import { handleNoShowHttp, liveNoShowHttpDeps } from "@/lib/reservation-no-show.http.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/no-show")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleNoShowHttp("read", request, params.id ?? "", liveNoShowHttpDeps()),
      POST: ({ request, params }) =>
        handleNoShowHttp("mark", request, params.id ?? "", liveNoShowHttpDeps()),
    },
  },
});
