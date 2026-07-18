import { createFileRoute } from "@tanstack/react-router";

const MAIN_BASE =
  process.env.OPEN_API_BASE_URL ?? "https://openapi.account.qne.cloud";
const REPORTING_BASE =
  process.env.OPEN_API_REPORTING_BASE_URL ??
  "https://openapi-reporting.account.qne.cloud";

// Same-origin proxy to N3 Open API. The browser must never call
// openapi.account.qne.cloud directly (CORS + secret-leak surface).
//
// URL shape:
//   /api/proxy/<host>/<open-api-path>
// where <host> is "main" or "reporting".
//
// Example: GET /api/proxy/main/api/companyprofile/BasicInfo
// forwards to: GET https://openapi.account.qne.cloud/api/companyprofile/BasicInfo
async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
  const splat = params._splat ?? "";
  const [hostKey, ...rest] = splat.split("/");
  const base =
    hostKey === "reporting" ? REPORTING_BASE : hostKey === "main" ? MAIN_BASE : null;
  if (!base) {
    return Response.json(
      { error: "Path must start with /api/proxy/main/... or /api/proxy/reporting/..." },
      { status: 400 },
    );
  }
  const upstreamPath = "/" + rest.join("/");
  const incomingUrl = new URL(request.url);
  const target = base + upstreamPath + incomingUrl.search;

  const auth = request.headers.get("authorization");
  if (!auth) {
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const headers = new Headers();
  headers.set("authorization", auth);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const upstream = await fetch(target, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  const respHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) respHeaders.set("content-type", ct);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/proxy/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
