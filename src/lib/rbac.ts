// HotelHub RBAC — three confirmed roles, deny-by-default permission matrix.
// Pure module (no I/O), safe to import from server and unit-test.

export type HotelRole = "owner" | "front_desk" | "housekeeper";

export const HOTEL_ROLES: readonly HotelRole[] = ["owner", "front_desk", "housekeeper"] as const;

export type Permission =
  | "app:view" // load the authenticated shell at all
  | "n3:verify" // run the read-only N3 verification probes
  | "n3:list_customers" // fetch N3 customer list for setup
  | "n3:list_stocks" // fetch N3 stock list for setup
  | "hotel:setup" // change tenant settings, walk-in customer, or rooms
  | "hotel:rooms:view" // read the rooms & rates table (with base_rate values)
  | "roles:manage"; // assign / revoke HotelHub roles

// Deny-by-default: only listed roles receive the permission.
const MATRIX: Record<Permission, ReadonlySet<HotelRole>> = {
  "app:view": new Set(["owner", "front_desk", "housekeeper"]),
  // Housekeeper must not receive N3 accounting data. Front desk should not
  // inspect accounting integration health — that is an Owner-only tool.
  "n3:verify": new Set(["owner"]),
  "n3:list_customers": new Set(["owner"]),
  "n3:list_stocks": new Set(["owner"]),
  "hotel:setup": new Set(["owner"]),
  // Front desk needs to see rates for future check-in flows; housekeeper
  // is excluded from rate values in this milestone.
  "hotel:rooms:view": new Set(["owner", "front_desk"]),
  "roles:manage": new Set(["owner"]),
};

export function isHotelRole(v: unknown): v is HotelRole {
  return typeof v === "string" && (HOTEL_ROLES as readonly string[]).includes(v);
}

export function hasPermission(role: HotelRole | null | undefined, permission: Permission): boolean {
  if (!role || !isHotelRole(role)) return false;
  const allowed = MATRIX[permission];
  return allowed ? allowed.has(role) : false;
}

export type AuthzDecision =
  | { ok: true; role: HotelRole }
  | { ok: false; reason: "unauthenticated" | "unprovisioned" | "role_unassigned" | "forbidden" };

export function authorize(
  ctx: { hasSession: boolean; tenantId: string | null; role: HotelRole | null },
  permission: Permission,
): AuthzDecision {
  if (!ctx.hasSession) return { ok: false, reason: "unauthenticated" };
  if (!ctx.tenantId) return { ok: false, reason: "unprovisioned" };
  if (!ctx.role || !isHotelRole(ctx.role)) return { ok: false, reason: "role_unassigned" };
  if (!hasPermission(ctx.role, permission)) return { ok: false, reason: "forbidden" };
  return { ok: true, role: ctx.role };
}
