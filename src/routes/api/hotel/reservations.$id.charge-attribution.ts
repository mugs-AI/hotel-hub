import { createFileRoute } from "@tanstack/react-router";
import {
  handleChargeAttributionHttp,
  liveChargeAttributionHttpDeps,
} from "@/lib/charge-attribution-http.server";
const handle = ({ request, params }: { request: Request; params: { id: string } }) =>
  handleChargeAttributionHttp(request, params.id, liveChargeAttributionHttpDeps());
export const Route = createFileRoute("/api/hotel/reservations/$id/charge-attribution")({
  server: { handlers: { GET: handle, POST: handle } },
});
