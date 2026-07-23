import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

// NOTE: HotelHub is intentionally N3-only. Do NOT reintroduce Supabase
// browser-auth middleware here — no server function uses
// `requireSupabaseAuth`, so adding it would trigger
// `supabase.auth.getSession()` on every RPC and leak a client-side
// Supabase session into the request path.

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

// Root-URL launch interceptor. See src/lib/launch.server.ts for the
// documented fail-closed flow that consumes the N3 launch token entirely
// server-side.
const rootTokenInterceptor = createMiddleware().server(async ({ next, request }) => {
  const { handleRootLaunchRequest } = await import("./lib/launch.server");
  const res = await handleRootLaunchRequest(request);
  return res ?? next();
});

export const startInstance = createStart(() => ({
  // HotelHub does not use Supabase Auth — N3 is the sole identity source.
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware, rootTokenInterceptor],
}));

