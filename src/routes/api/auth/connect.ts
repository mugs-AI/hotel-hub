import { createFileRoute } from "@tanstack/react-router";

const OPEN_API_BASE_URL =
  process.env.OPEN_API_BASE_URL ?? "https://openapi.account.qne.cloud";

// Dev-only API-key connect proxy (Path B).
// Returns 404 in production so the API key can never be exchanged outside dev.
export const Route = createFileRoute("/api/auth/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env.NODE_ENV === "production") {
          return new Response("Not found", { status: 404 });
        }

        let body: { apiKey?: string } = {};
        try {
          body = (await request.json()) as { apiKey?: string };
        } catch {
          return Response.json(
            { error: "Invalid JSON body" },
            { status: 400 },
          );
        }
        const apiKey = body.apiKey?.trim();
        if (!apiKey) {
          return Response.json(
            { error: "apiKey is required" },
            { status: 400 },
          );
        }

        const url = `${OPEN_API_BASE_URL}/api/auth/connect?api-key=${encodeURIComponent(apiKey)}`;
        const upstream = await fetch(url, { method: "GET" });
        const envelope = (await upstream.json().catch(() => null)) as
          | {
              code?: string;
              message?: string;
              data?: {
                token?: string;
                expiration?: string;
                company?: string;
                tenantCode?: string;
                email?: string;
              };
            }
          | null;

        if (!upstream.ok || !envelope || envelope.code !== "0000" || !envelope.data?.token) {
          return Response.json(
            {
              error: envelope?.message ?? "Failed to connect to N3 Open API",
              code: envelope?.code,
            },
            { status: upstream.status === 200 ? 401 : upstream.status },
          );
        }

        const { token, expiration, company, tenantCode, email } = envelope.data;
        // API key is never logged, persisted, or returned. Only the JWT flows onward.
        return Response.json({ token, expiration, company, tenantCode, email });
      },
    },
  },
});
