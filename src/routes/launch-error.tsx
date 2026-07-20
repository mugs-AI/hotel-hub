// Safe HotelHub launch-error view. Rendered after the root-token
// interceptor removed an N3 launch token and redirected here. The only
// information carried in the URL is a fixed allowlisted error code — no
// token, no upstream message, no stack trace.
import { createFileRoute } from "@tanstack/react-router";

const SAFE_CODES = [
  "session_expired",
  "n3_rejected",
  "n3_unavailable",
  "identity_unavailable",
  "launch_failed",
] as const;
type SafeCode = (typeof SAFE_CODES)[number];

function coerce(code: unknown): SafeCode {
  return typeof code === "string" && (SAFE_CODES as readonly string[]).includes(code)
    ? (code as SafeCode)
    : "launch_failed";
}

export const Route = createFileRoute("/launch-error")({
  validateSearch: (search: Record<string, unknown>) => ({ code: coerce(search.code) }),
  head: () => ({
    meta: [{ title: "HotelHub — Unable to start" }, { name: "robots", content: "noindex" }],
  }),
  component: LaunchErrorPage,
});

const MESSAGES: Record<SafeCode, string> = {
  session_expired: "Your N3 session has expired. Please launch HotelHub again from N3 My Apps.",
  n3_rejected: "N3 did not accept the launch token. Please launch HotelHub again from N3 My Apps.",
  n3_unavailable: "N3 could not be reached right now. Please try launching HotelHub again shortly.",
  identity_unavailable:
    "N3 did not return the identity information HotelHub needs to start a session.",
  launch_failed: "HotelHub could not start this session.",
};

// HotelHub brand palette (kept inline; no theme switcher, no runtime CSS).
const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const BG = "#F5F7FA";
const ERROR = "#C2413B";

function LaunchErrorPage() {
  const search = Route.useSearch() as { code: SafeCode };
  const code: SafeCode = search.code;
  const message = MESSAGES[code];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        color: NAVY,
      }}
    >
      <section
        role="alert"
        aria-labelledby="launch-error-title"
        style={{
          maxWidth: "28rem",
          width: "100%",
          background: "white",
          borderRadius: "0.75rem",
          padding: "2rem",
          boxShadow: "0 10px 30px rgba(16, 42, 67, 0.08)",
          borderTop: `4px solid ${ERROR}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: NAVY,
              color: "white",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
            }}
          >
            H
          </div>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1, color: TEAL, fontWeight: 600 }}>
              HOTELHUB
            </div>
            <div style={{ fontSize: 12, color: "#4b5563" }}>Boutique Hotel System</div>
          </div>
        </div>

        <h1
          id="launch-error-title"
          style={{ margin: "1.25rem 0 0.5rem", fontSize: "1.25rem", fontWeight: 700 }}
        >
          Unable to start HotelHub
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        <p style={{ margin: "0.75rem 0 1.5rem", color: "#4b5563", fontSize: 14, lineHeight: 1.5 }}>
          Please return to N3 My Apps and launch HotelHub again.
        </p>

        <a
          href="/"
          style={{
            display: "inline-block",
            padding: "0.6rem 1.1rem",
            background: NAVY,
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Return to HotelHub
        </a>

        <div
          style={{
            marginTop: "1.5rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #E5E7EB",
            fontSize: 12,
            color: "#6B7280",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Reference code</span>
          <code
            style={{
              background: BG,
              padding: "2px 8px",
              borderRadius: 4,
              color: GOLD,
              fontWeight: 600,
            }}
          >
            {code}
          </code>
        </div>
      </section>
    </main>
  );
}
