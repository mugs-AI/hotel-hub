import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

// Error boundary for uncaught server errors — must run outermost.
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Root-URL launch interceptor.
//
// The N3 My Apps launch URL is `GET /?token=<jwt>`. We intercept it here,
// BEFORE the router renders any React content, so the token is consumed by
// the shared server launch handler and never enters client JavaScript,
// browser storage, application logs, or rendered content. After the session
// cookie is set the browser is redirected to a token-free URL, so the
// address bar and history never persist the token either.
//
// Fail-closed: once we have started token handling we NEVER call next(),
// because that would risk rendering the app with the raw token still in
// the URL/query. On any exception we clear any pre-existing session and
// return a sanitized, token-free 302 back to `/`.
const rootTokenInterceptor = createMiddleware().server(async ({ next, request }) => {
  if (request.method !== "GET") return next();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return next();
  }
  if (url.pathname !== "/") return next();
  const token = url.searchParams.get("token");
  if (!token || !token.trim()) return next();

  // Token handling has begun. From here on we do not call next().
  try {
    const { performN3Launch, stripTokenFromUrl } = await import("./lib/launch.server");
    const cleanTarget = stripTokenFromUrl(url);
    return await performN3Launch(token, cleanTarget, "root");
  } catch (err) {
    console.error("[root-launch-interceptor] failed:", (err as Error).message?.slice(0, 200));
    try {
      const { getHotelSession } = await import("./lib/session.server");
      const s = await getHotelSession();
      await s.clear();
    } catch {
      /* clearing is best-effort */
    }
    return new Response(null, {
      status: 302,
      headers: { location: "/", "cache-control": "no-store" },
    });
  }
});

export const startInstance = createStart(() => ({
  // HotelHub does not use Supabase Auth — N3 is the sole identity source.
  // No Supabase browser-auth middleware is registered because no server
  // function requires `requireSupabaseAuth`; the server uses the
  // service-role client directly for tenant/role/audit access.
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware, rootTokenInterceptor],
}));
