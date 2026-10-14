import { isN3Guid } from "./n3-guid";
import { POSTING_COMPONENTS } from "./posting-mappings";
import type { MasterCaptureInput, MasterKind } from "./n3-settlement-master-diagnostics.server";
export type ConfiguredMasterIds = {
  schemaVersion: "hh-configured-master-ids-v1";
  contractAccepted: false;
  masters: MasterCaptureInput["masters"];
  missingKinds: MasterKind[];
  invalidReferenceCount: number;
};
export type ConfiguredMasterDb = {
  from(table: string): {
    select(columns: string, options: { count: "exact" }): ConfiguredMasterQuery;
  };
};
type ConfiguredMasterQuery = {
  eq(key: string, value: unknown): ConfiguredMasterQuery;
  order(key: string, options?: { ascending: boolean }): ConfiguredMasterQuery;
  limit(
    n: number,
  ): PromiseLike<{ data: Record<string, unknown>[] | null; count: number | null; error: unknown }>;
};
// These are saved references for an Owner diagnostic, never current N3 proof.
const kinds: MasterKind[] = ["customer", "currency", "stock", "uom", "tax", "account"];
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export async function loadConfiguredMasterIds(
  tenantId: string,
  db: ConfiguredMasterDb,
): Promise<ConfiguredMasterIds> {
  if (!isN3Guid(tenantId)) throw Error("invalid_tenant_scope");
  async function read(table: string, columns: string, many = false) {
    let query = db
      .from(table)
      .select("tenant_id," + columns, { count: "exact" })
      .eq("tenant_id", tenantId);
    if (many) query = query.eq("is_active", true);
    const result = await query
      .order(many ? "id" : "tenant_id", { ascending: true })
      .limit(many ? 201 : 2);
    if (
      result.error ||
      !Array.isArray(result.data) ||
      result.data.some((row) => row.tenant_id !== tenantId)
    )
      throw Error("configured_master_read_unavailable");
    if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0)
      throw Error("configured_master_read_unavailable");
    if (result.count > (many ? 200 : 1)) throw Error("configured_master_limit_exceeded");
    if (result.data.length !== result.count) throw Error("configured_master_read_unavailable");
    return result.data;
  }
  const [settings, rooms, addons, financial] = await Promise.all([
    read("hotel_settings", "n3_walk_in_customer_id"),
    read("hotel_rooms", "id,is_active,n3_stock_id", true),
    read("hotel_addon_catalogue", "id,is_active,n3_stock_id,n3_uom_id,n3_tax_code_id", true),
    read(
      "hotel_financial_settings",
      "n3_tax_code_accommodation_id,n3_tax_code_fnb_id,n3_tax_code_parking_id,n3_tax_code_other_id,n3_tax_code_exempt_id,n3_rounding_account_id,posting_mappings",
    ),
  ]);
  let invalidReferenceCount = 0;
  const references = new Map<string, MasterCaptureInput["masters"][number]>();
  function add(kind: MasterKind, value: unknown) {
    if (value === null || value === undefined || value === "") return;
    const text = typeof value === "string" ? value.trim() : String(value);
    const valid =
      kind === "account"
        ? isN3Guid(text)
        : /^(0*[1-9]\d*)$/.test(text) && text.length <= 20 && Number(text) <= 2147483647;
    if (!valid || (typeof value !== "string" && typeof value !== "number")) {
      invalidReferenceCount++;
      return;
    }
    const id = kind === "account" ? text.toLowerCase() : Number(text);
    references.set(`${kind}:${id}`, { kind, id });
  }
  settings.forEach((row) => add("customer", row.n3_walk_in_customer_id));
  rooms.forEach((row) => add("stock", row.n3_stock_id));
  addons.forEach((row) => {
    add("stock", row.n3_stock_id);
    add("uom", row.n3_uom_id);
    add("tax", row.n3_tax_code_id);
  });
  financial.forEach((row) => {
    for (const field of ["accommodation", "fnb", "parking", "other", "exempt"])
      add("tax", row[`n3_tax_code_${field}_id`]);
    add("account", row.n3_rounding_account_id);
    const mappings = row.posting_mappings;
    if (obj(mappings))
      for (const component of POSTING_COMPONENTS) {
        const mapping = mappings[component];
        if (!obj(mapping) || mapping.enabled !== true) continue;
        for (const [field, kind] of [
          ["stock", "stock"],
          ["uom", "uom"],
          ["taxCode", "tax"],
          ["resolvedAccount", "account"],
        ] as const) {
          const snapshot = mapping[field];
          if (obj(snapshot)) add(kind, snapshot.id);
        }
      }
  });
  const masters = [...references.values()].sort((a, b) => {
    const order = kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
    if (order) return order;
    return typeof a.id === "number" && typeof b.id === "number"
      ? a.id - b.id
      : String(a.id).localeCompare(String(b.id));
  });
  return {
    schemaVersion: "hh-configured-master-ids-v1",
    contractAccepted: false,
    masters,
    missingKinds: kinds.filter((kind) => !masters.some((m) => m.kind === kind)),
    invalidReferenceCount,
  };
}
