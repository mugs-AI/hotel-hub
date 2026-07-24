// Feature Pack Run 1 — focused regression tests for new behavior only.
// Higher-risk: filter contract, allow-list, calendar API, combobox helper.
import { describe, expect, it, beforeAll, vi } from "vitest";
import { buildListQuery, EMPTY_FILTERS } from "@/lib/reservations-ui";
import { __test } from "@/components/country-combobox";
import { widthContainerClass } from "@/lib/display-preference";

describe("Run 1 — list filter contract", () => {
  it("EMPTY_FILTERS includes guestMobile as empty string", () => {
    expect(EMPTY_FILTERS.guestMobile).toBe("");
  });

  it("buildListQuery only sets guestMobile when non-blank and trims it", () => {
    const off = buildListQuery(EMPTY_FILTERS, { limit: 25, offset: 0 });
    expect(off.get("guestMobile")).toBeNull();

    const on = buildListQuery(
      { ...EMPTY_FILTERS, guestMobile: "  012 345  " },
      { limit: 25, offset: 0 },
    );
    expect(on.get("guestMobile")).toBe("012 345");
  });

  it("buildListQuery never emits tenantId, n3Token, or role", () => {
    const p = buildListQuery(
      { ...EMPTY_FILTERS, guestMobile: "999", guestName: "Jane" },
      { limit: 10, offset: 0 },
    );
    for (const key of ["tenantId", "n3Token", "role", "n3UserKey"]) {
      expect(p.get(key)).toBeNull();
    }
  });
});

describe("Run 1 — CountryCombobox commit helper", () => {
  it("commits only on exact name or alpha-3 match", () => {
    expect(__test.commitFromText("Malaysia")).toBe("MYS");
    expect(__test.commitFromText("mys")).toBe("MYS");
    expect(__test.commitFromText("Mala")).toBe("");
    expect(__test.commitFromText("")).toBe("");
  });

  it("case-insensitive exact match resolves; partial does not", () => {
    expect(__test.commitFromText("SINGAPORE")).toBe("SGP");
    expect(__test.commitFromText("singap")).toBe("");
  });
});

describe("Run 1 — display preference width class", () => {
  it("standard is capped, full is unbounded", () => {
    expect(widthContainerClass("standard")).toContain("max-w-7xl");
    expect(widthContainerClass("full")).toContain("max-w-none");
    expect(widthContainerClass("full")).toContain("w-full");
  });
});

describe("Run 1 — reservation-calendar API contract", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = "https://x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
  });

  it("rejects invalid startDate", async () => {
    vi.doMock("@/lib/session-context.server", () => ({
      requirePermission: async () => ({
        ctx: { session: { tenantId: "t1", n3UserKey: "u1" } },
        decision: { ok: true, role: "owner" },
      }),
    }));
    const mod = await import("@/routes/api/hotel/reservation-calendar");
    const res = await mod.handleCalendar({
      request: new Request("http://x/api/hotel/reservation-calendar?startDate=not-a-date&days=14"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_start_date");
    vi.doUnmock("@/lib/session-context.server");
  });

  it("rejects unsupported days values", async () => {
    vi.doMock("@/lib/session-context.server", () => ({
      requirePermission: async () => ({
        ctx: { session: { tenantId: "t1", n3UserKey: "u1" } },
        decision: { ok: true, role: "owner" },
      }),
    }));
    const mod = await import("@/routes/api/hotel/reservation-calendar");
    const res = await mod.handleCalendar({
      request: new Request("http://x/api/hotel/reservation-calendar?startDate=2026-08-01&days=21"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_days");
    vi.doUnmock("@/lib/session-context.server");
  });

  it("denies housekeeper (forbidden)", async () => {
    vi.doMock("@/lib/session-context.server", () => ({
      requirePermission: async () => ({
        ctx: { session: { tenantId: "t1", n3UserKey: "u1" } },
        decision: { ok: false, reason: "forbidden" },
      }),
    }));
    const mod = await import("@/routes/api/hotel/reservation-calendar");
    const res = await mod.handleCalendar({
      request: new Request("http://x/api/hotel/reservation-calendar?startDate=2026-08-01&days=14"),
    });
    expect(res.status).toBe(403);
    vi.doUnmock("@/lib/session-context.server");
  });
});
