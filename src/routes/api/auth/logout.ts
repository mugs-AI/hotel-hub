import { createFileRoute } from "@tanstack/react-router";
import { destroySession } from "@/lib/session-context.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async () => {
        await destroySession("user_signout");
        return Response.json({ ok: true });
      },
    },
  },
});
