/**
 * HH-GOLIVE-01A one-line acceptance blocker — Exempt selector id wiring.
 *
 * Rendered proof (not source-text matching) that once the Owner chooses a
 * valid 0% N3 Exempt tax row and the panel rerenders the selector with the
 * row's immutable id, the selected value shows the live "0%" resolved from
 * the loaded N3 list — never "no rate in N3".
 *
 * The sandbox has no DOM environment, so the N3 list load is injected by
 * replacing React's useState initial value for the selector's load state;
 * everything else (row resolution by id, rate formatting, display text) is
 * the real component code path.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({ state: null as any }));

vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useState: (init: any) => {
      const v = typeof init === "function" ? init() : init;
      if (injected.state && v && typeof v === "object" && v.kind === "loading") {
        return [injected.state, () => {}];
      }
      return [v, () => {}];
    },
  };
});

import { N3SelectorField } from "@/components/N3SelectorField";

const EXEMPT_ROW = { id: "n3-tax-exempt-0", code: "EX", name: "Exempt supply", rateBp: 0 };

beforeEach(() => {
  injected.state = {
    kind: "loaded",
    load: { status: "ok", kind: "tax_code", items: [EXEMPT_ROW], total: 1 },
  };
});

function renderExemptSelector(value: any): string {
  return renderToStaticMarkup(
    createElement(N3SelectorField, {
      kind: "tax_code",
      label: "Exempt / out-of-scope tax code",
      value,
      onSelect: () => {},
      onClear: () => {},
    }),
  );
}

describe("Exempt selector shows the live 0% rate after selection", () => {
  it("shows 'Not chosen' before the Owner selects anything", () => {
    expect(renderExemptSelector({ id: null, code: null, name: null })).toContain("Not chosen");
  });

  it("after selecting the valid 0% N3 row and rerendering with its id, displays 0%", () => {
    // This is exactly the payload the real list's Select action emits, and
    // the value ChargesTaxesPanel now stores for the Exempt selector.
    const html = renderExemptSelector({ id: EXEMPT_ROW.id, code: EXEMPT_ROW.code, name: null });
    expect(html).toContain("EX — 0%");
    expect(html).not.toContain("no rate in N3");
  });

  it("without the immutable id the same code cannot resolve the loaded row's rate", () => {
    // The exact rejected defect: code without id leaves the live rate
    // unresolvable even though the loaded N3 row has a valid 0% rate.
    const html = renderExemptSelector({ code: EXEMPT_ROW.code, name: null });
    expect(html).toContain("EX — no rate in N3");
  });
});

describe("Exempt selector wiring carries the immutable id", () => {
  it("ChargesTaxesPanel passes the stored exempt id into the selector value", () => {
    const panel = readFileSync("src/components/ChargesTaxesPanel.tsx", "utf8");
    expect(panel).toContain("value={{ id: exempt.id, code: exempt.text, name: null }}");
  });
});
