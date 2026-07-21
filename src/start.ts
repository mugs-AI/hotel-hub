import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// NOTE: HotelHub is intentionally N3-only. Do NOT reintroduce
// `attachSupabaseAuth` here — no server function uses `requireSupabaseAuth`,
// so adding it would trigger `supabase.auth.getSession()` on every RPC and
// leak a client-side Supabase session into the request path.
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
// browser storage, application logs, or rendered content.
//
// Fail-closed: once we have started token handling we NEVER call next(),
// because that would risk rendering the app with the raw token still in
// the URL/query. On any failure — including exceptions — we clear any
// pre-existing session and return a token-free 302 to a safe launch-error
// view keyed by an allowlisted error code.
const rootTokenInterceptor = createMiddleware().server(async ({ next, request }) => {
  const { handleRootLaunchRequest } = await import("./lib/launch.server");
  const res = await handleRootLaunchRequest(request);
  return res ?? next();
});

export const startInstance = createStart(() => ({
  // HotelHub does not use Supabase Auth — N3 is the sole identity source.
  // No Supabase browser-auth middleware is registered because no server
  // function requires `requireSupabaseAuth`; the server uses the
  // service-role client directly for tenant/role/audit access.
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, rootTokenInterceptor],
}));
