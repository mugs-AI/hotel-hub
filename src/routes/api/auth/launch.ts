// N3 launch entry (Path A). GET /api/auth/launch?token=<jwt>
// The identical server logic also runs from the root-token interceptor
// registered in `src/start.ts`, which handles the primary N3 My Apps
// launch URL: `GET /?token=<jwt>`.
import { createFileRoute } from "@tanstack/react-router";
import { performN3Launch, stripTokenFromUrl } from "@/lib/launch.server";

export async function handleLaunch({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  // Preserve unrelated query params on the clean redirect target ("/" by default,
  // since the launch endpoint has no user-facing surface of its own).
  const params = new URLSearchParams(url.searchParams);
  params.delete("token");
  const clean = "/" + (params.toString() ? `?${params.toString()}` : "");
  void stripTokenFromUrl; // re-exported for tests
  return performN3Launch(token, clean, "path_a");
}

export const Route = createFileRoute("/api/auth/launch")({
  server: { handlers: { GET: handleLaunch } },
});
