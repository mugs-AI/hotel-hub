import { createFileRoute } from "@tanstack/react-router";
import { handleSavedDocumentCheckHttp } from "@/lib/saved-documents-check-http.server";
import { liveSavedCheckHttpDeps } from "@/lib/saved-documents-check-adapter.server";
export const Route = createFileRoute("/api/hotel/reservations/$id/saved-documents-check")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSavedDocumentCheckHttp(request, params.id ?? "", liveSavedCheckHttpDeps()),
      POST: ({ request, params }) =>
        handleSavedDocumentCheckHttp(request, params.id ?? "", liveSavedCheckHttpDeps()),
    },
  },
});
