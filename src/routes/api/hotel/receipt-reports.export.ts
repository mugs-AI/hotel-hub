// GET /api/hotel/receipt-reports/export — Owner-only, server tenant scope, no-store.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hotel/receipt-reports.export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleFinancialRequest, defaultFinancialHttpDeps } =
          await import("@/lib/financial-reporting-http.server");
        return handleFinancialRequest(request, "export", defaultFinancialHttpDeps());
      },
    },
  },
});
