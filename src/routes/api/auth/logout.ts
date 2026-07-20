import { createFileRoute } from "@tanstack/react-router";
import { destroySession } from "@/lib/session-context.server";

export async function handleLogout(): Promise<Response> {
  await destroySession("user_signout");
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/auth/logout")({
  server: { handlers: { POST: handleLogout } },
});
