// GET /api/hotel/financial-period — Owner-only current property month (settings only, no N3), server tenant scope, no-store.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hotel/financial-period")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleFinancialRequest, defaultFinancialHttpDeps } =
          await import("@/lib/financial-reporting-http.server");
        return handleFinancialRequest(request, "period", defaultFinancialHttpDeps());
      },
    },
  },
});
