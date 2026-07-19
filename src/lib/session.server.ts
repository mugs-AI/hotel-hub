// Server-side encrypted session. HttpOnly, Secure, SameSite=Lax cookie.
// The N3 access token lives ONLY here — never returned to the browser.
// `useSession` from TanStack's server runtime is a request-context helper,
// not a React hook — alias it so the react-hooks lint rule doesn't misfire.
import { useSession as tanstackUseSession } from "@tanstack/react-start/server";

export type HotelSessionData = {
  // Raw N3 JWT. Server-only.
  n3Token: string;
  n3TokenExpiration?: string | null;
  // Verified N3 identity (from BasicInfo).
  n3TenantKey: string;
  tenantCode: string | null;
  companyName: string | null;
  n3UserKey: string;
  userEmail: string | null;
  userName: string | null;
  // Local tenant row id after DB sync.
  tenantId: string | null;
  createdAt: number;
};

const SESSION_COOKIE_NAME = "hotelhub_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function sessionPassword(): string {
  const pw = process.env.HOTELHUB_SESSION_SECRET;
  if (!pw || pw.length < 32) {
    throw new Error("HOTELHUB_SESSION_SECRET is not configured (must be at least 32 chars).");
  }
  return pw;
}

export function getHotelSession() {
  return useSession<HotelSessionData>({
    password: sessionPassword(),
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  });
}
