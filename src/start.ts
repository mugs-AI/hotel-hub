import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

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
const rootTokenInterceptor = createMiddleware().server(async ({ next, request }) => {
  try {
    if (request.method !== "GET") return next();
    const url = new URL(request.url);
    if (url.pathname !== "/") return next();
    const token = url.searchParams.get("token");
    if (!token || !token.trim()) return next();

    const { performN3Launch, stripTokenFromUrl } = await import("./lib/launch.server");
    const cleanTarget = stripTokenFromUrl(url);
    return await performN3Launch(token, cleanTarget, "root");
  } catch (err) {
    console.error("[root-launch-interceptor] failed:", (err as Error).message?.slice(0, 200));
    return next();
  }
});

export const startInstance = createStart(() => ({
  // HotelHub does not use Supabase Auth — N3 is the sole identity source.
  // No `attachSupabaseAuth` client middleware is registered because no
  // server function requires `requireSupabaseAuth`; the server uses the
  // service-role client directly for tenant/role/audit access.
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, rootTokenInterceptor],
}));
