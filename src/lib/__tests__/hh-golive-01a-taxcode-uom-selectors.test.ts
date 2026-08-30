// HH-GOLIVE-01A — Output Tax code and stock-linked unit-of-measure selectors.
//
// Behavioural proof that the two newly proven read-only N3 GET contracts are
// parsed strictly, filtered fail-closed, stock-scoped, and never written to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractStrictPage,
  listAllN3TaxCodes,
  listAllN3Uoms,
  mapN3TaxCodeRow,
  mapN3UomRow,
  N3_TAX_CODE_PATH,
  N3_UOM_PATH,
} from "@/lib/n3-gateway.server";
import {
  isSelectableOutputTaxCode,
  isSelectableUomForStock,
  loadN3Selector,
  N3SelectorForbidden,
  N3SelectorUnauthorized,
} from "@/lib/n3-selectors.server";
import { N3_SELECTOR_CONTRACTS, selectorRequiresStock } from "@/lib/n3-selectors";
import {
  CANONICALIZE_ERRORS,
  canonicalErrorStatus,
  canonicalizeAddonInput,
  canonicalizeSettingsPatch,
  type SelectorLoader,
} from "@/lib/n3-canonicalize.server";
import { defaultPostingMappings } from "@/lib/posting-mappings";

type Call = { url: string; init?: RequestInit };

const calls: Call[] = [];
let responder: (url: string) => { status: number; body: unknown };

function envelope(value: unknown[], count: number) {
  return { code: "0000", data: { value, count } };
}

function json(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

beforeEach(() => {
  calls.length = 0;
  responder = () => ({ status: 200, body: envelope([], 0) });
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const r = responder(u);
    return json(r.status, r.body);
  });
});

afterEach(() => vi.unstubAllGlobals());

const TOKEN = "n3-token";

describe("proven contracts", () => {
  it("marks exactly the two documented GET query paths as proven", () => {
    expect(N3_TAX_CODE_PATH).toBe("/api/TaxCodes/OutputTax/Query");
    expect(N3_UOM_PATH).toBe("/api/UOMs/Query");
    expect(N3_SELECTOR_CONTRACTS.tax_code.proven).toBe(true);
    expect(N3_SELECTOR_CONTRACTS.uom.proven).toBe(true);
    expect(selectorRequiresStock("uom")).toBe(true);
    expect(selectorRequiresStock("tax_code")).toBe(false);
  });

  it("preserves the existing stock and GL contracts", () => {
    expect(N3_SELECTOR_CONTRACTS.stock.endpoint).toBe("/api/stocks/list");
    expect(N3_SELECTOR_CONTRACTS.gl_account.endpoint).toBe("/api/AccountCodes/Leaf/Query");
  });
});

describe("documented envelope and pagination", () => {
  it("accepts the documented success envelope and rejects everything else", () => {
    expect(extractStrictPage(envelope([{ id: "1" }], 1))).toEqual({
      ok: true,
      items: [{ id: "1" }],
      total: 1,
    });
    expect(extractStrictPage({ success: true, data: { value: [], count: 0 } }).ok).toBe(true);
    expect(extractStrictPage({ code: "9999", data: { value: [] } }).ok).toBe(false);
    expect(extractStrictPage({ data: { value: [] } }).ok).toBe(false);
    expect(extractStrictPage({ code: "0000", data: { value: "nope" } }).ok).toBe(false);
    expect(extractStrictPage(null).ok).toBe(false);
    expect(extractStrictPage([{ id: "1" }]).ok).toBe(false);
  });

  it("reads every page of a multi-page list with bounded $top/$skip", async () => {
    const total = 250;
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      const top = Number(new URL(url).searchParams.get("$top"));
      const rows = [];
      for (let i = skip; i < Math.min(total, skip + top); i++) {
        rows.push({ id: `T${i}`, code: `TX${i}`, isActive: true, isOutputTax: true });
      }
      return { status: 200, body: envelope(rows, total) };
    };
    const { items } = await listAllN3TaxCodes(TOKEN);
    expect(items).toHaveLength(total);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c.url).toContain(N3_TAX_CODE_PATH);
      expect(c.url).toMatch(/\$top=\d+/);
      expect(c.url).toMatch(/\$skip=\d+/);
      expect((c.init?.method ?? "GET").toUpperCase()).toBe("GET");
    }
  });

  it("fails closed on a malformed page and returns no rows", async () => {
    responder = () => ({ status: 200, body: { code: "9999", message: "nope" } });
    await expect(listAllN3TaxCodes(TOKEN)).rejects.toThrow();
  });

  it("fails closed on a non-2xx upstream status", async () => {
    responder = () => ({ status: 500, body: {} });
    await expect(listAllN3Uoms(TOKEN)).rejects.toThrow();
  });

  it("fails closed when a later page is incomplete", async () => {
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      if (skip === 0) {
        const rows = Array.from({ length: 200 }, (_, i) => ({
          id: `U${i}`,
          code: `EA${i}`,
          isActive: true,
          stockId: "S1",
        }));
        return { status: 200, body: envelope(rows, 1000) };
      }
      return { status: 503, body: {} };
    };
    await expect(listAllN3Uoms(TOKEN)).rejects.toThrow();
  });

  it("rejects a contradictory envelope where an explicit code denies success", () => {
    expect(
      extractStrictPage({ code: "9999", success: true, data: { value: [], count: 0 } }).ok,
    ).toBe(false);
    expect(extractStrictPage({ Code: "9999", Success: true, data: { value: [] } }).ok).toBe(false);
    // success:true remains a valid declaration only when no code field exists.
    expect(extractStrictPage({ success: true, data: { value: [], count: 0 } }).ok).toBe(true);
  });

  it("rejects a contradictory envelope through the paginated read as well", async () => {
    responder = () => ({
      status: 200,
      body: { code: "9999", success: true, data: { value: [], count: 0 } },
    });
    await expect(listAllN3TaxCodes(TOKEN)).rejects.toThrow();
  });

  it("fails immediately when the declared total exceeds the hard cap", async () => {
    responder = () => ({
      status: 200,
      body: envelope(
        Array.from({ length: 100 }, (_, i) => ({
          id: `T${i}`,
          code: `TX${i}`,
          isActive: true,
          isOutputTax: true,
        })),
        10_001,
      ),
    });
    await expect(listAllN3TaxCodes(TOKEN)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("fails incomplete on a short non-final page before the declared total", async () => {
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      const n = skip === 0 ? 100 : 3; // second page is short but non-empty
      const rows = Array.from({ length: n }, (_, i) => ({
        id: `T${skip + i}`,
        code: `TX${skip + i}`,
        isActive: true,
        isOutputTax: true,
      }));
      return { status: 200, body: envelope(rows, 250) };
    };
    await expect(listAllN3TaxCodes(TOKEN)).rejects.toThrow();
  });

  it("fails incomplete when the declared total changes between pages", async () => {
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: `T${skip + i}`,
        code: `TX${skip + i}`,
        isActive: true,
        isOutputTax: true,
      }));
      return { status: 200, body: envelope(rows, skip === 0 ? 250 : 300) };
    };
    await expect(listAllN3TaxCodes(TOKEN)).rejects.toThrow();
  });

  it("accepts an exact final partial page and returns every raw row", async () => {
    const total = 205;
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      const top = Number(new URL(url).searchParams.get("$top"));
      const rows = [];
      for (let i = skip; i < Math.min(total, skip + top); i++) {
        rows.push({ id: `T${i}`, code: `TX${i}`, isActive: true, isOutputTax: true });
      }
      return { status: 200, body: envelope(rows, total) };
    };
    const { items, total: reported } = await listAllN3TaxCodes(TOKEN);
    expect(items).toHaveLength(total);
    expect(reported).toBe(total);
  });

  it("measures completeness on raw rows even when mapping drops some", async () => {
    const total = 150;
    responder = (url) => {
      const skip = Number(new URL(url).searchParams.get("$skip"));
      const top = Number(new URL(url).searchParams.get("$top"));
      const rows = [];
      for (let i = skip; i < Math.min(total, skip + top); i++) {
        rows.push(i % 2 === 0 ? { id: `T${i}`, code: `TX${i}` } : { nope: true });
      }
      return { status: 200, body: envelope(rows, total) };
    };
    const { items } = await listAllN3TaxCodes(TOKEN);
    expect(items).toHaveLength(75);
  });
});

describe("row normalization and eligibility", () => {
  it("tolerates casing variants and numeric identifiers", () => {
    expect(
      mapN3TaxCodeRow({ Id: 42, Code: "SR", Description: "Standard", IsActive: true }),
    ).toEqual({
      id: "42",
      code: "SR",
      name: "Standard",
      isActive: true,
      isOutputTax: null,
      rateBp: null,
    });
    expect(mapN3UomRow({ id: 7, code: "EA", isActive: true, StockId: 9 })).toEqual({
      id: "7",
      code: "EA",
      name: null,
      isActive: true,
      stockId: "9",
    });
  });

  it("never exposes postingAccountId, and carries only the normalized live rate", () => {
    const row = mapN3TaxCodeRow({
      id: "1",
      code: "SR",
      rate: 6,
      postingAccountId: "GL-SECRET",
      isActive: true,
      isOutputTax: true,
    });
    expect(JSON.stringify(row)).not.toContain("GL-SECRET");
    expect(row && "rate" in row).toBe(false);
    // The live N3 rate is normalized to basis points; it is a prefill only and
    // the server always re-reads and overwrites it on save.
    expect(row?.rateBp).toBe(600);
  });

  it("rejects inactive or non-output tax codes and missing flags", () => {
    const base = { id: "1", code: "SR" };
    expect(isSelectableOutputTaxCode({ ...base, isActive: true, isOutputTax: true })).toBe(true);
    expect(isSelectableOutputTaxCode({ ...base, isActive: false, isOutputTax: true })).toBe(false);
    expect(isSelectableOutputTaxCode({ ...base, isActive: true, isOutputTax: false })).toBe(false);
    expect(isSelectableOutputTaxCode({ ...base, isActive: null, isOutputTax: true })).toBe(false);
    expect(isSelectableOutputTaxCode({ ...base, isActive: true, isOutputTax: null })).toBe(false);
  });

  it("only accepts a unit of measure linked to the exact stock", () => {
    const row = { id: "U1", code: "EA", isActive: true, stockId: "S1" };
    expect(isSelectableUomForStock(row, "S1")).toBe(true);
    expect(isSelectableUomForStock(row, "S2")).toBe(false);
    expect(isSelectableUomForStock({ ...row, isActive: null }, "S1")).toBe(false);
    expect(isSelectableUomForStock({ ...row, stockId: null }, "S1")).toBe(false);
  });
});

describe("selector loading", () => {
  it("returns sanitized output tax rows only", async () => {
    responder = () => ({
      status: 200,
      body: envelope(
        [
          { id: "1", code: "SR", description: "Standard", isActive: true, isOutputTax: true },
          { id: "2", code: "IN", description: "Input", isActive: true, isOutputTax: false },
          { id: "3", code: "OLD", description: "Retired", isActive: false, isOutputTax: true },
          {
            id: "4",
            code: "ZR",
            description: "Zero rated",
            isActive: true,
            isOutputTax: true,
            postingAccountId: "GL-SECRET",
          },
        ],
        4,
      ),
    });
    const load = await loadN3Selector(TOKEN, "tax_code");
    expect(load.status).toBe("ok");
    if (load.status !== "ok") return;
    expect(load.items.map((r) => r.code)).toEqual(["SR", "ZR"]);
    expect(JSON.stringify(load)).not.toContain("GL-SECRET");
  });

  it("refuses the unit-of-measure list without a stock context and never calls N3", async () => {
    const load = await loadN3Selector(TOKEN, "uom");
    expect(load.status).toBe("stock_context_required");
    expect(calls).toHaveLength(0);
  });

  it("refuses a malformed stock context without calling N3", async () => {
    const load = await loadN3Selector(TOKEN, "uom", { stockId: "x".repeat(500) });
    expect(load.status).toBe("stock_context_required");
    expect(calls).toHaveLength(0);
  });

  it("filters the unit-of-measure list to the exact stock", async () => {
    responder = () => ({
      status: 200,
      body: envelope(
        [
          { id: "U1", code: "EA", isActive: true, stockId: "S1" },
          { id: "U2", code: "BOX", isActive: true, stockId: "S2" },
          { id: "U3", code: "OFF", isActive: false, stockId: "S1" },
        ],
        3,
      ),
    });
    const load = await loadN3Selector(TOKEN, "uom", { stockId: "S1" });
    expect(load.status).toBe("ok");
    if (load.status !== "ok") return;
    expect(load.items.map((r) => r.id)).toEqual(["U1"]);
  });

  it("treats 401 as token expiry and 403 as a permission decision", async () => {
    responder = () => ({ status: 401, body: {} });
    await expect(loadN3Selector(TOKEN, "tax_code")).rejects.toBeInstanceOf(N3SelectorUnauthorized);
    responder = () => ({ status: 403, body: {} });
    await expect(loadN3Selector(TOKEN, "uom", { stockId: "S1" })).rejects.toBeInstanceOf(
      N3SelectorForbidden,
    );
  });

  it("issues read-only GET requests only — no N3 write path", async () => {
    responder = () => ({ status: 200, body: envelope([], 0) });
    await loadN3Selector(TOKEN, "tax_code");
    await loadN3Selector(TOKEN, "uom", { stockId: "S1" });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect((c.init?.method ?? "GET").toUpperCase()).toBe("GET");
      expect(c.init?.body).toBeUndefined();
    }
  });
});

// ---------------------------------------------------- effective-pair writes

function loaderFor(
  rowsByKind: Record<string, Array<{ id: string; code: string }>>,
): SelectorLoader {
  return async (kind, ctx) => {
    if (kind === "uom") {
      const stockId = ctx?.stockId ?? null;
      if (!stockId) return { status: "stock_context_required", kind };
      const items = (rowsByKind[`uom:${stockId}`] ?? []).map((r) => ({ ...r, name: null }));
      return { status: "ok", kind, items, total: items.length };
    }
    const items = (rowsByKind[kind] ?? []).map((r) => ({ ...r, name: null }));
    return { status: "ok", kind, items, total: items.length };
  };
}

const ROWS = {
  stock: [
    { id: "S1", code: "ROOM" },
    { id: "S2", code: "SPA" },
  ],
  tax_code: [{ id: "T1", code: "SR" }],
  "uom:S1": [{ id: "U1", code: "EA" }],
  "uom:S2": [{ id: "U2", code: "HR" }],
};

describe("catalogue effective stock/UOM pair", () => {
  it("accepts a matching pair on create and stores canonical snapshots", async () => {
    const out = await canonicalizeAddonInput(
      { name: "Spa", n3StockId: "S1", n3UomId: "U1", n3UomSnapshot: "SPOOFED" },
      loaderFor(ROWS),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.n3UomId).toBe("U1");
    expect(out.value.n3UomSnapshot).toBe("EA");
    expect(out.value.n3StockCodeSnapshot).toBe("ROOM");
  });

  it("rejects a cross-stock unit of measure before any write", async () => {
    const out = await canonicalizeAddonInput({ n3StockId: "S1", n3UomId: "U2" }, loaderFor(ROWS));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe(CANONICALIZE_ERRORS.uomStockMismatch);
    expect(canonicalErrorStatus(out.code)).toBe(422);
  });

  it("rejects a unit of measure with no effective stock at all", async () => {
    const out = await canonicalizeAddonInput({ n3UomId: "U1" }, loaderFor(ROWS));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe(CANONICALIZE_ERRORS.uomRequiresStock);
    expect(canonicalErrorStatus(out.code)).toBe(422);
  });

  it("validates a partial update against the persisted stock", async () => {
    const out = await canonicalizeAddonInput({ n3UomId: "U1" }, loaderFor(ROWS), {
      n3StockId: "S1",
      n3UomId: null,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.n3UomSnapshot).toBe("EA");
  });

  it("fails when a partial stock change would strand the persisted unit", async () => {
    const out = await canonicalizeAddonInput({ n3StockId: "S2" }, loaderFor(ROWS), {
      n3StockId: "S1",
      n3UomId: "U1",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(CANONICALIZE_ERRORS.uomStockMismatch);
  });

  it("allows a stock change that also reselects a compatible unit", async () => {
    const out = await canonicalizeAddonInput({ n3StockId: "S2", n3UomId: "U2" }, loaderFor(ROWS), {
      n3StockId: "S1",
      n3UomId: "U1",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.n3UomSnapshot).toBe("HR");
  });

  it("leaves an untouched compatible pair alone", async () => {
    const out = await canonicalizeAddonInput({ name: "Renamed" }, loaderFor(ROWS), {
      n3StockId: "S1",
      n3UomId: "U1",
    });
    expect(out.ok).toBe(true);
  });
});

describe("posting mapping effective pair", () => {
  it("rejects a cross-stock unit of measure in settings", async () => {
    const out = await canonicalizeSettingsPatch(
      {
        postingMappings: {
          service_charge: {
            stock: { id: "S1", code: "x", name: null },
            uom: { id: "U2", code: "x", name: null },
          },
        },
      },
      loaderFor(ROWS),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(CANONICALIZE_ERRORS.uomStockMismatch);
  });

  it("canonicalizes a matching settings pair and ignores browser snapshots", async () => {
    const out = await canonicalizeSettingsPatch(
      {
        postingMappings: {
          service_charge: {
            stock: { id: "S1", code: "SPOOF", name: "SPOOF" },
            uom: { id: "U1", code: "SPOOF", name: "SPOOF" },
            taxCode: { id: "T1", code: "SPOOF", name: "SPOOF" },
          },
        },
      },
      loaderFor(ROWS),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const m = out.value.postingMappings?.service_charge;
    expect(m?.stock?.code).toBe("ROOM");
    expect(m?.uom?.code).toBe("EA");
    expect(m?.taxCode?.code).toBe("SR");
  });
});
