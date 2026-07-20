// N3 launch entry (Path A). GET /api/auth/launch?token=<jwt>
// The identical server logic also runs from the root-token interceptor
// registered in `src/start.ts`, which handles the primary N3 My Apps
// launch URL: `GET /?token=<jwt>`.
//
// Milestone 1.0.2: this secondary entry gets the same token-free failure
// conversion as the root path. On success we redirect to a clean URL; on
// any failure we clear any pre-existing session and 302 to
// `/launch-error?code=<safe>`. The token never appears in the response
// body, Location header, logs, or audit detail.
import { createFileRoute } from "@tanstack/react-router";
import {
  performN3Launch,
  redirectToLaunchError,
  stripTokenFromUrl,
  LAUNCH_ERROR_HEADER,
  SAFE_LAUNCH_ERROR_CODES,
  type SafeLaunchErrorCode,
} from "@/lib/launch.server";
import { getHotelSession } from "@/lib/session.server";

function mapStatusToSafeCode(status: number): SafeLaunchErrorCode {
  if (status === 401) return "n3_rejected";
  if (status === 502) return "n3_unavailable";
  return "launch_failed";
}

async function clearSessionBestEffort() {
  try {
    const s = await getHotelSession();
    await s.clear();
  } catch {
    /* best effort */
  }
}

export async function handleLaunch({ request }: { request: Request }): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    await clearSessionBestEffort();
    return redirectToLaunchError("launch_failed");
  }
  const token = url.searchParams.get("token") ?? "";
  if (!token || !token.trim()) {
    await clearSessionBestEffort();
    return redirectToLaunchError("launch_failed");
  }
  // Preserve unrelated query params on the clean redirect target.
  const cleanTarget =
    "/" +
    stripTokenFromUrl(url)
      .replace(/^\/?/, "")
      .replace(/^api\/auth\/launch/, "");
  const finalTarget = cleanTarget && cleanTarget !== "/" ? cleanTarget : "/";

  try {
    const res = await performN3Launch(token, finalTarget, "path_a");
    if (res.status >= 300 && res.status < 400) return res;
    const headerCode = res.headers.get(LAUNCH_ERROR_HEADER);
    const code: SafeLaunchErrorCode =
      headerCode && (SAFE_LAUNCH_ERROR_CODES as readonly string[]).includes(headerCode)
        ? (headerCode as SafeLaunchErrorCode)
        : mapStatusToSafeCode(res.status);
    await clearSessionBestEffort();
    return redirectToLaunchError(code);
  } catch (err) {
    console.error("[launch-route] failed:", (err as Error)?.message?.slice(0, 200));
    await clearSessionBestEffort();
    return redirectToLaunchError("launch_failed");
  }
}

export const Route = createFileRoute("/api/auth/launch")({
  server: { handlers: { GET: handleLaunch } },
});
