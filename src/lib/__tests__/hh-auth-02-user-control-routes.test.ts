/**
 * HH-AUTH-02 — API route boundary + rendered Settings surface.
 *
 * Proves owner-only access to /api/hotel/user-control, that tenant and actor
 * are taken from the verified session (never the browser body), that upstream
 * failures fail closed with safe codes, and that the Settings tab + panel
 * render their loading / empty / error / saving states accessibly.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasPermission } from "@/lib/rbac";

// -------- session context mock --------
const perm = vi.hoisted(() => ({
  ok: true as boolean,
  reason: "" as string,
  session: {
    n3Token: "n3-secret-token-value",
    tenantId: "tenant-1",
    n3UserKey: "u-owner",
    userEmail: "owner@mugs.com.my",
    userName: "Theng",
  } as Record<string, unknown>,
}));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: { session: perm.session },
    decision: perm.ok ? { ok: true } : { ok: false, reason: perm.reason },
  }),
}));

// -------- domain mock --------
const domain = vi.hoisted(() => ({
  list: { status: "ok", rows: [], skippedWithoutIdentifier: 0, actorKeyAlignsWithN3Id: true } as any,
  apply: { ok: true, n3UserKey: "u-admin", from: "none", to: "front_desk", changed: true } as any,
  listArgs: [] as any[],
  applyArgs: [] as any[],
}));
vi.mock("@/lib/user-control.server", () => ({
  listUserControl: async (input: unknown) => {
    domain.listArgs.push(input);
    return domain.list;
  },
  applyUserAccess: async (input: unknown) => {
    domain.applyArgs.push(input);
    return domain.apply;
  },
}));

const { handleAssignUserControl, handleListUserControl } = await import(
  "@/routes/api/hotel/user-control"
);
const { UserControlPanel, accessLabel } = await import("@/components/UserControlPanel");
const { visibleSettingsTabs } = await import("@/routes/settings");
const clientMod = await import("@/lib/user-control-client");

function post(body: unknown, origin = "https://hotel.example"): Request {
  return new Request(`${origin}/api/hotel/user-control`, {
    method: "POST",
    headers: { origin, host: "hotel.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  perm.ok = true;
  perm.reason = "";
  perm.session = {
    n3Token: "n3-secret-token-value",
    tenantId: "tenant-1",
    n3UserKey: "u-owner",
    userEmail: "owner@mugs.com.my",
    userName: "Theng",
  };
  domain.listArgs = [];
  domain.applyArgs = [];
  domain.list = {
    status: "ok",
    rows: [],
    skippedWithoutIdentifier: 0,
    actorKeyAlignsWithN3Id: true,
  };
  domain.apply = { ok: true, n3UserKey: "u-admin", from: "none", to: "front_desk", changed: true };
});

describe("GET /api/hotel/user-control", () => {
  it("requires roles:manage and reports 401 vs 403 distinctly", async () => {
    perm.ok = false;
    perm.reason = "unauthenticated";
    expect((await handleListUserControl()).status).toBe(401);
    perm.reason = "role_denied";
    const denied = await handleListUserControl();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "role_denied" });
    expect(domain.listArgs).toHaveLength(0);
  });

  it("passes the session tenant/actor and never caches the response", async () => {
    const res = await handleListUserControl();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(domain.listArgs[0]).toEqual({
      token: "n3-secret-token-value",
      tenantId: "tenant-1",
      actorN3UserKey: "u-owner",
    });
    expect(JSON.stringify(await res.json())).not.toContain("n3-secret-token-value");
  });

  it("fails closed with safe codes when N3 or the store cannot answer", async () => {
    for (const [status, expected, code] of [
      ["upstream_unavailable", 503, "n3_users_unavailable"],
      ["upstream_malformed", 502, "n3_users_malformed"],
      ["store_unavailable", 503, "user_control_unavailable"],
    ] as const) {
      domain.list = { status };
      const res = await handleListUserControl();
      expect(res.status).toBe(expected);
      expect(await res.json()).toEqual({ error: code });
    }
  });
});

describe("POST /api/hotel/user-control", () => {
  it("rejects cross-origin writes before touching the domain", async () => {
    const res = await handleAssignUserControl({
      request: post({ targetN3UserKey: "u-admin", access: "front_desk" }, "https://evil.example"),
    });
    expect(res.status).toBe(403);
    expect(domain.applyArgs).toHaveLength(0);
  });

  it("refuses browser-supplied tenant or actor identity", async () => {
    for (const forged of [
      { targetN3UserKey: "u-admin", access: "front_desk", tenantId: "tenant-2" },
      { targetN3UserKey: "u-admin", access: "front_desk", actorN3UserKey: "u-admin" },
      { targetN3UserKey: "u-admin", access: "owner", role: "owner" },
    ]) {
      const res = await handleAssignUserControl({ request: post(forged) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_field" });
    }
    expect(domain.applyArgs).toHaveLength(0);
  });

  it("derives tenant and actor from the session only", async () => {
    const res = await handleAssignUserControl({
      request: post({ targetN3UserKey: "u-admin", access: "front_desk" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      n3UserKey: "u-admin",
      access: "front_desk",
      changed: true,
    });
    expect(domain.applyArgs[0]).toMatchObject({
      tenantId: "tenant-1",
      actorN3UserKey: "u-owner",
      targetN3UserKey: "u-admin",
      access: "front_desk",
    });
  });

  it("propagates domain rejections with their status and safe code", async () => {
    domain.apply = { ok: false, code: "target_is_owner", status: 403 };
    const res = await handleAssignUserControl({
      request: post({ targetN3UserKey: "u-owner", access: "none" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "target_is_owner" });
  });

  it("requires roles:manage for writes too", async () => {
    perm.ok = false;
    perm.reason = "role_denied";
    const res = await handleAssignUserControl({
      request: post({ targetN3UserKey: "u-admin", access: "front_desk" }),
    });
    expect(res.status).toBe(403);
    expect(domain.applyArgs).toHaveLength(0);
  });
});

describe("Settings surface", () => {
  it("shows the User Control tab only to roles that hold roles:manage", () => {
    const ids = (role: any) => visibleSettingsTabs(role).map((t) => t.id);
    expect(ids("owner")).toContain("users");
    for (const role of ["front_desk", "housekeeper", null] as const) {
      expect(hasPermission(role, "roles:manage")).toBe(false);
      expect(ids(role)).not.toContain("users");
    }
  });

  it("maps every access value to plain wording", () => {
    expect(accessLabel("owner")).toBe("Owner");
    expect(accessLabel("front_desk")).toBe("Front Desk");
    expect(accessLabel("housekeeper")).toBe("Housekeeper");
    expect(accessLabel("none")).toBe("No access");
  });

  it("never renders an unsafe or raw upstream error string", () => {
    for (const code of [
      "n3_users_unavailable",
      "owner_check_failed",
      "target_is_owner",
      "boom: Error at line 12",
    ]) {
      const text = clientMod.userControlErrorText(code);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain(code === "boom: Error at line 12" ? "line 12" : "\u0000");
    }
  });

  function renderPanel(state: Partial<Record<string, unknown>>): string {
    vi.spyOn(clientMod, "useUserControl").mockReturnValue({
      data: null,
      errorCode: null,
      isLoading: false,
      savingKey: null,
      savedKey: null,
      rowErrors: {},
      refresh: async () => {},
      setAccess: async () => {},
      ...state,
    } as any);
    return renderToStaticMarkup(createElement(UserControlPanel));
  }

  it("renders loading, empty, error and populated states", () => {
    expect(renderPanel({ isLoading: true })).toContain("Loading N3 users…");

    expect(
      renderPanel({
        data: { rows: [], skippedWithoutIdentifier: 0, actorKeyAlignsWithN3Id: true },
      }),
    ).toContain("No active N3 users");

    const err = renderPanel({ errorCode: "n3_users_unavailable" });
    expect(err).toContain('role="alert"');
    expect(err).toContain("N3 could not be reached");

    const rows = [
      {
        n3UserKey: "u-owner",
        displayName: "Theng",
        email: "owner@mugs.com.my",
        access: "owner",
        isCurrentN3Owner: true,
        manageable: false,
        staleLocalRole: null,
      },
      {
        n3UserKey: "u-admin",
        displayName: "ADMIN",
        email: "ADMIN@MUGS.COM.MY",
        access: "front_desk",
        isCurrentN3Owner: false,
        manageable: true,
        staleLocalRole: null,
      },
    ];
    const populated = renderPanel({
      data: { rows, skippedWithoutIdentifier: 0, actorKeyAlignsWithN3Id: true },
      savingKey: "u-admin",
    });
    // recognition by name/email, never by the immutable identifier
    expect(populated).toContain("ADMIN@MUGS.COM.MY");
    expect(populated).not.toContain("u-admin");
    // the N3 Owner row is locked: no choice controls for it
    expect(populated).toContain("Owner (from N3)");
    expect(populated).not.toContain("HotelHub access for Theng");
    // accessible single-choice controls for the manageable row
    expect(populated).toContain('role="radiogroup"');
    expect(populated).toContain('aria-label="HotelHub access for ADMIN"');
    expect(populated).toContain("No access");
    expect(populated).toContain("Front Desk");
    expect(populated).toContain("Housekeeper");
    expect(populated).toContain('aria-checked="true"');
    // save-in-progress disables that row's controls
    expect(populated).toContain("disabled=\"\"");
    expect(populated).toContain('aria-live="polite"');

    const rowFailure = renderPanel({
      data: { rows, skippedWithoutIdentifier: 1, actorKeyAlignsWithN3Id: true },
      rowErrors: { "u-admin": "target_inactive" },
    });
    expect(rowFailure).toContain("inactive and cannot be given HotelHub access");
    expect(rowFailure).toContain("stable identifier");
  });
});
