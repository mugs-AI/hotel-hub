// HotelHub RBAC — three confirmed roles, deny-by-default permission matrix.
// Pure module (no I/O), safe to import from server and unit-test.

export type HotelRole = "owner" | "front_desk" | "housekeeper";

export const HOTEL_ROLES: readonly HotelRole[] = ["owner", "front_desk", "housekeeper"] as const;

export type Permission =
  | "app:view" // load the authenticated shell at all
  | "n3:verify" // run the read-only N3 verification probes
  | "n3:list_customers" // fetch N3 customer list for setup
  | "n3:list_stocks" // fetch N3 stock list for setup
  | "n3:financial_verify" // run the Owner-only N3 Financial Verification console
  | "hotel:setup" // change tenant settings, walk-in customer, or rooms
  | "hotel:rooms:view" // read the rooms & rates table (with base_rate values)
  | "hotel:reservations:view" // read reservation list / detail / availability
  | "hotel:reservations:create" // create new reservations
  | "hotel:reservations:edit" // edit an existing, still-editable reservation
  | "hotel:deposits:view" // read the reservation deposit ledger
  | "hotel:deposits:create" // post a reservation deposit to N3 (AR Receive Payment)
  | "hotel:reservations:check_in" // perform a standard check-in
  | "hotel:reservations:assign_guests" // assign guests to rooms within a reservation
  | "hotel:operations:view" // read the operation request ledger + timeline
  | "hotel:operations:request" // raise an operation request needing approval
  | "hotel:operations:approve" // approve / reject an operation request
  | "hotel:checkout:view" // read the departures board and the read-only checkout preview
  // HH-GOLIVE-01A — authoritative folio, add-on catalogue and tax readiness
  | "hotel:folio:view" // read the prepared folio for a reservation
  | "hotel:folio:add_item" // add a catalogue add-on / change its quantity
  | "hotel:folio:adjust" // discount, manual adjustment, price override, reversal
  | "hotel:folio:tax_class" // classify the guest for Tourism Tax purposes
  | "hotel:charges:manage" // manage the add-on catalogue, tax config and evidence
  // WP1 — Housekeeping & Room Turnaround
  | "hotel:housekeeping:view" // see the room turnaround board
  | "hotel:housekeeping:update" // move a room through the cleaning lifecycle
  | "hotel:housekeeping:dnd" // set or clear the Do Not Disturb overlay
  | "hotel:housekeeping:initialize" // bootstrap housekeeping for existing rooms
  | "roles:manage"; // assign / revoke HotelHub roles

// Deny-by-default: only listed roles receive the permission.
const MATRIX: Record<Permission, ReadonlySet<HotelRole>> = {
  "app:view": new Set(["owner", "front_desk", "housekeeper"]),
  // Housekeeper must not receive N3 accounting data. Front desk should not
  // inspect accounting integration health — that is an Owner-only tool.
  "n3:verify": new Set(["owner"]),
  "n3:list_customers": new Set(["owner"]),
  "n3:list_stocks": new Set(["owner"]),
  "n3:financial_verify": new Set(["owner"]),
  "hotel:setup": new Set(["owner"]),
  // Front desk needs to see rates for future check-in flows; housekeeper
  // is excluded from rate values in this milestone.
  "hotel:rooms:view": new Set(["owner", "front_desk"]),
  "hotel:reservations:view": new Set(["owner", "front_desk"]),
  "hotel:reservations:create": new Set(["owner", "front_desk"]),
  // Editing is a distinct duty from creating: stage + guest policy are
  // enforced separately on the server.
  "hotel:reservations:edit": new Set(["owner", "front_desk"]),
  // Front desk may READ the deposit ledger (operational awareness) but must
  // never post an AR Receive Payment: financial writes to N3 are Owner-only.
  "hotel:deposits:view": new Set(["owner", "front_desk"]),
  "hotel:deposits:create": new Set(["owner"]),

  // Front-desk reservation operations. Requesting is a front-desk duty;
  // approving an exception (early check-in, late checkout, room change,
  // stay extension, rate change) is Owner-only.
  "hotel:reservations:check_in": new Set(["owner", "front_desk"]),
  "hotel:reservations:assign_guests": new Set(["owner", "front_desk"]),
  "hotel:operations:view": new Set(["owner", "front_desk"]),
  "hotel:operations:request": new Set(["owner", "front_desk"]),
  "hotel:operations:approve": new Set(["owner"]),

  // Read-only departures board + checkout preview (Run 5D3.1). Housekeeper is
  // excluded: the preview exposes room rates and deposit money.
  "hotel:checkout:view": new Set(["owner", "front_desk"]),

  // WP1 Housekeeping. Everyone operational sees and works the board — that is
  // the point of ONE engine, TWO experiences. Do Not Disturb is a capability
  // every operational role may hold: a housekeeper standing at the door is the
  // person who learns the guest does not want the room entered. The property's
  // workflow narrows it further — `housekeepingAuthority` denies a housekeeper
  // any authority at all in Simple (front-desk) mode. Bootstrapping existing
  // rooms stays a property-setup act and remains Owner-only.
  "hotel:housekeeping:view": new Set(["owner", "front_desk", "housekeeper"]),
  "hotel:housekeeping:update": new Set(["owner", "front_desk", "housekeeper"]),
  "hotel:housekeeping:dnd": new Set(["owner", "front_desk", "housekeeper"]),
  "hotel:housekeeping:initialize": new Set(["owner"]),

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
