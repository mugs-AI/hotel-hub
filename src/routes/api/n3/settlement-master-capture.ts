import { createFileRoute } from "@tanstack/react-router";
import {
  handleMasterCapture,
  liveMasterCaptureDeps,
} from "@/lib/n3-settlement-master-diagnostics.http.server";
export const Route = createFileRoute("/api/n3/settlement-master-capture")({
  server: {
    handlers: { POST: ({ request }) => handleMasterCapture(request, liveMasterCaptureDeps()) },
  },
});
