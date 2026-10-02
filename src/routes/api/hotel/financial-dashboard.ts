// GET /api/hotel/financial-dashboard — Owner-only, server tenant scope, no-store.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hotel/financial-dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleFinancialRequest, defaultFinancialHttpDeps } =
          await import("@/lib/financial-reporting-http.server");
        return handleFinancialRequest(request, "dashboard", defaultFinancialHttpDeps());
      },
    },
  },
});
