import { describe, expect, it } from "vitest";
import {
  loadConfiguredMasterIds,
  type ConfiguredMasterDb,
} from "../n3-settlement-master-config.server";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = "11111111-1111-1111-1111-111111111111";
function database(
  tables: Record<string, Record<string, unknown>[]>,
  failed = "",
  responseCap = Infinity,
) {
  const reads: Array<{
    table: string;
    filters: Record<string, unknown>;
    limit: number;
    columns: string;
  }> = [];
  const db: ConfiguredMasterDb = {
    from(table: string) {
      const query = {
        table,
        filters: {} as Record<string, unknown>,
        limit: 0,
        columns: "",
        countExact: false,
      };
      const builder = {
        select(columns: string, options?: { count: "exact" }) {
          query.columns = columns;
          query.countExact = options?.count === "exact";
          return builder;
        },
        eq(key: string, value: unknown) {
          query.filters[key] = value;
          return builder;
        },
        order() {
          return builder;
        },
        async limit(n: number) {
          query.limit = n;
          reads.push(query);
          const matching = (tables[table] ?? []).filter((row) =>
            Object.entries(query.filters).every(([k, v]) => row[k] === v),
          );
          return {
            count: query.countExact ? matching.length : null,
            data: (tables[table] ?? [])
              .filter((row) => Object.entries(query.filters).every(([k, v]) => row[k] === v))
              .slice(0, Math.min(n, responseCap)),
            error: table === failed ? { message: "private failure" } : null,
          };
        },
      };
      return builder;
    },
  };
  return { db, reads };
}
const row = (values: Record<string, unknown>) => ({ tenant_id: tenant, ...values });
describe("saved billing master references", () => {
  it("returns only own-tenant configured identities without names, contacts or invented currency", async () => {
    const { db, reads } = database({
      hotel_settings: [
        row({ n3_walk_in_customer_id: "71", customerName: "private" }),
        { tenant_id: "alien", n3_walk_in_customer_id: "99" },
      ],
      hotel_rooms: [
        row({ id: "r1", is_active: true, n3_stock_id: "101" }),
        row({ id: "r2", is_active: false, n3_stock_id: "999" }),
      ],
      hotel_addon_catalogue: [
        row({ id: "a1", is_active: true, n3_stock_id: "102", n3_uom_id: "1", n3_tax_code_id: "2" }),
      ],
      hotel_financial_settings: [
        row({
          n3_tax_code_accommodation_id: "2",
          n3_rounding_account_id: account.toUpperCase(),
          posting_mappings: {
            tourism_tax: {
              enabled: true,
              stock: { id: "103" },
              uom: { id: "1" },
              taxCode: { id: "3" },
              resolvedAccount: { id: account },
            },
            discount: { enabled: false, stock: { id: "999" } },
            arbitrary: { enabled: true, stock: { id: "998" } },
          },
        }),
      ],
    });
    const result = await loadConfiguredMasterIds(tenant, db);
    expect(result).toEqual({
      schemaVersion: "hh-configured-master-ids-v1",
      contractAccepted: false,
      invalidReferenceCount: 0,
      masters: [
        { kind: "customer", id: 71 },
        { kind: "stock", id: 101 },
        { kind: "stock", id: 102 },
        { kind: "stock", id: 103 },
        { kind: "uom", id: 1 },
        { kind: "tax", id: 2 },
        { kind: "tax", id: 3 },
        { kind: "account", id: account },
      ],
      missingKinds: ["currency"],
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(reads).toHaveLength(4);
    expect(reads.every((r) => r.filters.tenant_id === tenant && r.limit > 0)).toBe(true);
    expect(reads.every((r) => !r.columns.includes("name") && !r.columns.includes("phone"))).toBe(
      true,
    );
  });
  it("deduplicates numeric IDs and records invalid references without returning their values", async () => {
    const { db } = database({
      hotel_settings: [row({ n3_walk_in_customer_id: "customer-secret" })],
      hotel_rooms: [
        row({ id: "1", is_active: true, n3_stock_id: "00101" }),
        row({ id: "2", is_active: true, n3_stock_id: "101" }),
        row({ id: "3", is_active: true, n3_stock_id: "2147483648" }),
      ],
    });
    const result = await loadConfiguredMasterIds(tenant, db);
    expect(result.masters).toEqual([{ kind: "stock", id: 101 }]);
    expect(result.invalidReferenceCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });
  it("keeps more than twenty saved identities for explicit capture batches", async () => {
    const { db } = database({
      hotel_rooms: Array.from({ length: 25 }, (_, i) =>
        row({ id: String(i), is_active: true, n3_stock_id: String(i + 1) }),
      ),
    });
    const result = await loadConfiguredMasterIds(tenant, db);
    expect(result.masters).toHaveLength(25);
    expect(result.masters.at(-1)).toEqual({ kind: "stock", id: 25 });
  });
  it("refuses a truncated local catalogue rather than returning a partial setup", async () => {
    const { db } = database({
      hotel_rooms: Array.from({ length: 201 }, (_, i) =>
        row({ id: String(i), is_active: true, n3_stock_id: String(i + 1) }),
      ),
    });
    await expect(loadConfiguredMasterIds(tenant, db)).rejects.toThrow(
      "configured_master_limit_exceeded",
    );
  });
  it("does not return partial data after a database failure", async () => {
    const { db } = database(
      { hotel_settings: [row({ n3_walk_in_customer_id: "71" })] },
      "hotel_financial_settings",
    );
    await expect(loadConfiguredMasterIds(tenant, db)).rejects.toThrow(
      "configured_master_read_unavailable",
    );
  });
  it("refuses missing tenant scope before database access", async () => {
    const { db, reads } = database({});
    await expect(loadConfiguredMasterIds("", db)).rejects.toThrow("invalid_tenant_scope");
    expect(reads).toHaveLength(0);
  });
  it("refuses a lower server row cap rather than treating the returned IDs as complete", async () => {
    const { db } = database(
      {
        hotel_rooms: Array.from({ length: 25 }, (_, i) =>
          row({ id: String(i), is_active: true, n3_stock_id: String(i + 1) }),
        ),
      },
      "",
      10,
    );
    await expect(loadConfiguredMasterIds(tenant, db)).rejects.toThrow(
      "configured_master_read_unavailable",
    );
  });
});
