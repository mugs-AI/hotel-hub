import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { folioBodyPt, folioNotePt } from "../folio-print-options";

const state = vi.hoisted(() => ({
  allowed: true,
  updates: [] as Array<{ tenantId: string; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: { session: { tenantId: "tenant-A", n3UserKey: "owner-A" } },
    decision: state.allowed ? { ok: true } : { ok: false, reason: "forbidden" },
  }),
}));
vi.mock("@/lib/hotel-store.server", () => ({
  updateHotelSettings: async (tenantId: string, patch: Record<string, unknown>) => {
    state.updates.push({ tenantId, patch });
    return { tenantId, ...patch };
  },
  getOrCreateHotelSettings: async () => ({}),
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

function request(body: unknown): Request {
  return new Request("https://hotel.example/api/hotel/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("property-wide folio paper settings", () => {
  it("uses the requested 8.5pt item and 5pt note defaults", () => {
    expect(folioBodyPt(undefined)).toBe(8.5);
    expect(folioNotePt(undefined)).toBe(5);
    expect(folioBodyPt(9.5)).toBe(9.5);
    expect(folioNotePt(6.5)).toBe(6.5);
  });

  it("requires the matching migration and generated type fields before release", () => {
    const sql = readFileSync(
      "supabase/migrations/20260928235000_hh_folio_print_typography.sql",
      "utf8",
    );
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    for (const column of [
      "folio_body_pt",
      "folio_note_pt",
      "folio_contact_address",
      "folio_contact_phone",
      "folio_contact_email",
    ]) {
      expect(sql).toContain(column);
      expect(types).toContain(column);
    }
  });

  it("rejects invalid print sizes and contact details without a partial save", async () => {
    state.allowed = true;
    state.updates.length = 0;
    const { handlePatchSettings } = await import("@/routes/api/hotel/settings");
    const invalid = await handlePatchSettings({
      request: request({ folioBodyPt: 5, folioNotePt: 5 }),
    });
    expect(invalid.status).toBe(400);
    const email = await handlePatchSettings({
      request: request({ folioBodyPt: 8.5, folioContactEmail: "bad" }),
    });
    expect(email.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("saves valid settings only for the authorized tenant", async () => {
    state.allowed = true;
    state.updates.length = 0;
    const { handlePatchSettings } = await import("@/routes/api/hotel/settings");
    const response = await handlePatchSettings({
      request: request({
        folioBodyPt: 8.5,
        folioNotePt: 5,
        folioContactAddress: "Hotel street",
        folioContactPhone: "05-1234567",
        folioContactEmail: "frontdesk@example.com",
      }),
    });
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([
      {
        tenantId: "tenant-A",
        patch: {
          folioBodyPt: 8.5,
          folioNotePt: 5,
          folioContactAddress: "Hotel street",
          folioContactPhone: "05-1234567",
          folioContactEmail: "frontdesk@example.com",
        },
      },
    ]);
    state.allowed = false;
    const denied = await handlePatchSettings({ request: request({ folioBodyPt: 9 }) });
    expect(denied.status).toBe(403);
    expect(state.updates).toHaveLength(1);
  });
});
