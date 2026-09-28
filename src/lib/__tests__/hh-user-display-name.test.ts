import { describe, expect, it, vi } from "vitest";
import type { N3UsersRead } from "@/lib/n3-owner";

vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));
const { updateUserDisplayName } = await import("@/lib/user-control.server");

const users: N3UsersRead = {
  status: "ok",
  users: [
    {
      id: "owner-1",
      userName: "owner@example.com",
      email: "owner@example.com",
      isOwner: true,
      isActive: true,
    },
    {
      id: "staff-1",
      userName: "staff@example.com",
      email: "staff@example.com",
      isOwner: false,
      isActive: true,
    },
    { id: "old-1", userName: "Old", email: null, isOwner: false, isActive: false },
  ],
};

const input = {
  tenantId: "tenant-1",
  actorN3UserKey: "owner-1",
  token: "server-only-token",
  targetN3UserKey: "staff-1",
  displayName: "Front Desk Lina",
};

describe("Owner-managed HotelHub display names", () => {
  it("writes only the matched, active N3 user's name in the session tenant", async () => {
    const saveName = vi.fn(async () => {});
    const result = await updateUserDisplayName(input, {
      readUsers: async () => users,
      saveName,
    });
    expect(result).toEqual({ ok: true, n3UserKey: "staff-1", displayName: "Front Desk Lina" });
    expect(saveName).toHaveBeenCalledWith("tenant-1", "staff-1", "Front Desk Lina");
  });

  it("rejects an unverified Owner, unknown or inactive target and email label", async () => {
    const saveName = vi.fn(async () => {});
    const deps = { readUsers: async () => users, saveName };
    expect((await updateUserDisplayName({ ...input, actorN3UserKey: "staff-1" }, deps)).ok).toBe(
      false,
    );
    expect(
      (await updateUserDisplayName({ ...input, targetN3UserKey: "other-tenant-user" }, deps)).ok,
    ).toBe(false);
    expect((await updateUserDisplayName({ ...input, targetN3UserKey: "old-1" }, deps)).ok).toBe(
      false,
    );
    expect(
      (await updateUserDisplayName({ ...input, displayName: "staff@example.com" }, deps)).ok,
    ).toBe(false);
    expect(saveName).not.toHaveBeenCalled();
  });
});
