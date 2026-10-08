// N3 document/account GUIDs need not carry RFC UUID version/variant bits.
// Shape validation supplies no document ownership or accounting authority.
export const isN3Guid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value) &&
  value !== "00000000-0000-0000-0000-000000000000";
