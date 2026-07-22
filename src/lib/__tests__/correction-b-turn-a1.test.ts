/**
 * Milestone 1.1.2 — Correction B, Turn A.1
 * Focused tests for the redesigned Booking Sources Settings UI:
 *   - Safe DTO includes usedCount, excludes tenantId
 *   - Tenant-scoped usage count
 *   - No window.confirm() and no Delete action in settings.tsx
 *   - Add/Edit dialog explanatory text
 *   - Confirmation dialog copy (deactivate + used count)
 *   - Active/Inactive pill labels
 *   - Reorder disabled at edges
 *   - Owner-only settings route + N3-only identity guardrails
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ---------- Supabase admin mock for store ----------
type Result = { data: unknown; error: unknown };
const queues = new Map<string, Result[]>();
function enqueue(t: string, r: Result) {
  const a = queues.get(t) ?? [];
  a.push(r);
  queues.set(t, a);
}
function builder(t: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => queues.get(t)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: Result) => unknown) =>
      resolve(queues.get(t)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

beforeEach(() => queues.clear());

describe("Booking sources store — usedCount", () => {
  it("aggregates reservation counts per source_code for the tenant only", async () => {
    const { listBookingSources } = await import("@/lib/booking-sources-store.server");
    enqueue("hotel_booking_sources", {
      data: [
        {
          id: "s1",
          tenant_id: "T1",
          source_code: "walk_in",
          display_name: "Walk-in",
          is_active: true,
          sort_order: 10,
        },
        {
          id: "s2",
          tenant_id: "T1",
          source_code: "phone",
          display_name: "Phone",
          is_active: false,
          sort_order: 20,
        },
      ],
      error: null,
    });
    enqueue("hotel_reservations", {
      data: [
        { booking_source: "walk_in" },
        { booking_source: "walk_in" },
        { booking_source: "phone" },
        { booking_source: null },
      ],
      error: null,
    });
    const rows = await listBookingSources("T1");
    const walk = rows.find((r) => r.sourceCode === "walk_in")!;
    const phone = rows.find((r) => r.sourceCode === "phone")!;
    expect(walk.usedCount).toBe(2);
    expect(phone.usedCount).toBe(1);
  });

  it("returns usedCount=0 when a source has no reservations", async () => {
    const { listBookingSources } = await import("@/lib/booking-sources-store.server");
    enqueue("hotel_booking_sources", {
      data: [
        {
          id: "s1",
          tenant_id: "T1",
          source_code: "agoda",
          display_name: "Agoda",
          is_active: true,
          sort_order: 10,
        },
      ],
      error: null,
    });
    enqueue("hotel_reservations", { data: [], error: null });
    const rows = await listBookingSources("T1");
    expect(rows[0]!.usedCount).toBe(0);
  });
});

describe("Booking sources API — safe DTO shape", () => {
  it("route maps usedCount into the response and never spreads the raw source", () => {
    const src = readFileSync("src/routes/api/hotel/booking-sources.ts", "utf8");
    expect(src).toMatch(/usedCount:\s*s\.usedCount/);
    // Never spread the whole source into the response (would leak tenantId)
    expect(src).not.toMatch(/sources:\s*sources\.map\(\(s\)\s*=>\s*\(\{\s*\.\.\.s/);
    // The explicit response fields are the safe allow-list only
    const responseBlock = src.match(/sources\.map\(\(s\) => \(\{[\s\S]*?\}\)\)/)?.[0] ?? "";
    expect(responseBlock).not.toMatch(/tenant/i);
  });
});

describe("Settings UI — file-level guarantees", () => {
  const src = readFileSync("src/routes/settings.tsx", "utf8");

  it("does not use window.confirm()", () => {
    expect(src).not.toMatch(/window\.confirm\s*\(/);
    expect(src).not.toMatch(/\bconfirm\s*\(/);
  });

  it("has no Delete action", () => {
    expect(src).not.toMatch(/>\s*Delete\s*</);
    expect(src).not.toMatch(/["']Delete\s+(source|booking)/i);
  });

  it("renders Active and Inactive labels", () => {
    expect(src).toMatch(/>\s*Active\s*</);
    expect(src).toMatch(/>\s*Inactive\s*</);
  });

  it("renders reservation usage count with tooltip help text", () => {
    expect(src).toMatch(/Number of existing reservations using this source\./);
    expect(src).toMatch(/usedCount/);
  });

  it("Add dialog explains the internal code is auto-generated and immutable", () => {
    expect(src).toMatch(/internal code is generated automatically and cannot be changed/i);
  });

  it("Edit dialog treats internal code as read-only", () => {
    expect(src).toMatch(/Read-only\s+—\s+cannot be changed/i);
    // ensure no PATCH sends sourceCode from the browser
    expect(src).not.toMatch(/sourceCode:\s*[^,}\n]*name/);
  });

  it("Deactivation confirmation explains preservation and shows used count", () => {
    expect(src).toMatch(/Deactivate booking source\?/);
    expect(src).toMatch(/Existing\s+reservation\s+history[\s\S]{0,60}preserved/i);
    expect(src).toMatch(/existing reservation/i);
    expect(src).toMatch(/usedCount\s*>\s*0/);
  });

  it("Restore action exists for inactive sources", () => {
    expect(src).toMatch(/Restore/);
  });

  it("uses AlertDialog for deactivation confirmation", () => {
    expect(src).toMatch(/AlertDialog/);
  });

  it("disables Move Up/Down at the edges (isFirst/isLast wired to ReorderGroup)", () => {
    expect(src).toMatch(/isFirst\s*\|\|\s*disabled/);
    expect(src).toMatch(/isLast\s*\|\|\s*disabled/);
  });

  it("summary cards render Total/Active/Inactive counts", () => {
    expect(src).toMatch(/Total Sources/);
    expect(src).toMatch(/label="Active"/);
    expect(src).toMatch(/label="Inactive"/);
  });

  it("gates on hasPermission(role, 'hotel:setup')", () => {
    expect(src).toMatch(/hasPermission\(\s*role,\s*["']hotel:setup["']\s*\)/);
  });
});

describe("N3-only identity guardrails remain intact", () => {
  it("src/start.ts keeps functionMiddleware: []", () => {
    const src = readFileSync("src/start.ts", "utf8");
    expect(src).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(src).not.toMatch(/attachSupabaseAuth/);
  });

  it("forbidden Supabase browser-auth files remain deleted", () => {
    expect(existsSync("src/integrations/supabase/auth-attacher.ts")).toBe(false);
    expect(existsSync("src/integrations/supabase/auth-middleware.ts")).toBe(false);
    expect(existsSync("src/integrations/supabase/client.ts")).toBe(false);
  });
});
