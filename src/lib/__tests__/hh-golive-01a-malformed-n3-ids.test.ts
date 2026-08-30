import { describe, expect, it, vi } from "vitest";
import {
  CANONICALIZE_ERRORS,
  canonicalErrorStatus,
  canonicalizeAddonInput,
  type SelectorLoader,
} from "../n3-canonicalize.server";

const FIELDS = ["n3StockId", "n3UomId", "n3TaxCodeId"] as const;

const MALFORMED: Array<[string, unknown]> = [
  ["number", 12345],
  ["boolean", true],
  ["object", { id: "S1" }],
  ["array", ["S1"]],
  ["overlong string", "x".repeat(121)],
];

describe("HH-GOLIVE-01A malformed catalogue N3 identifiers", () => {
  for (const field of FIELDS) {
    for (const [label, value] of MALFORMED) {
      it(`rejects ${label} for ${field} with stable invalid_n3_mapping and no selector call`, async () => {
        const load = vi.fn<SelectorLoader>();
        const result = await canonicalizeAddonInput({ name: "Item", [field]: value }, load);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe(CANONICALIZE_ERRORS.invalidMapping);
          expect(result.code).toBe("invalid_n3_mapping");
          expect(canonicalErrorStatus(result.code)).toBe(400);
        }
        expect(load).not.toHaveBeenCalled();
      });
    }

    it(`allows explicit null to clear ${field} without a selector call`, async () => {
      const load = vi.fn<SelectorLoader>();
      const result = await canonicalizeAddonInput({ name: "Item", [field]: null }, load);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value[field]).toBeNull();
      expect(load).not.toHaveBeenCalled();
    });

    it(`allows empty/whitespace to clear ${field} without a selector call`, async () => {
      const load = vi.fn<SelectorLoader>();
      const result = await canonicalizeAddonInput({ name: "Item", [field]: "   " }, load);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value[field]).toBeNull();
      expect(load).not.toHaveBeenCalled();
    });
  }

  it("fails on the first malformed field even when another field is valid", async () => {
    const load = vi.fn<SelectorLoader>();
    const result = await canonicalizeAddonInput(
      { name: "Item", n3StockId: "STOCK-1", n3UomId: 7 },
      load,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CANONICALIZE_ERRORS.invalidMapping);
    expect(load).not.toHaveBeenCalled();
  });

  it("still canonicalizes a valid string identifier through the N3 list", async () => {
    const load: SelectorLoader = vi.fn(async () => ({
      status: "ok" as const,
      items: [{ id: "STOCK-1", code: "STK1", name: "Laundry" }],
    })) as unknown as SelectorLoader;
    const result = await canonicalizeAddonInput({ name: "Item", n3StockId: "STOCK-1" }, load);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.n3StockId).toBe("STOCK-1");
      expect(result.value.n3StockCodeSnapshot).toBe("STK1");
    }
    expect(load).toHaveBeenCalledWith("stock");
  });

  it("accepts a boundary-length 120 character identifier shape", async () => {
    const id = "x".repeat(120);
    const load: SelectorLoader = vi.fn(async () => ({
      status: "ok" as const,
      items: [{ id, code: "STK1", name: "Laundry" }],
    })) as unknown as SelectorLoader;
    const result = await canonicalizeAddonInput({ name: "Item", n3StockId: id }, load);
    expect(result.ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
