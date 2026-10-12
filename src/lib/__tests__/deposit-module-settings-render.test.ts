import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DepositModuleControls } from "@/components/DepositModuleSettingsPanel";
const version = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
it("renders two independent switches without implying security is operational", () => {
  const html = renderToStaticMarkup(
    createElement(DepositModuleControls, {
      state: {
        policy: { roomAdvanceEnabled: true, securityDepositEnabled: false, version },
        available: true,
        securityReady: false,
      },
      onChange: () => {},
      disabled: false,
    }),
  );
  expect(html).toContain('aria-label="Room Advance Payments"');
  expect(html).toContain('aria-label="Refundable Security Deposits"');
  expect(html.match(/role="switch"/g)).toHaveLength(2);
  expect(html).toMatch(/aria-label="Room Advance Payments"[^>]*checked/);
  expect(html).toMatch(/aria-label="Refundable Security Deposits"[^>]*disabled/);
  expect(html).toContain("Security cash collection is not available yet.");
});
it("advance_off_keeps_checkout_payment and existing cash returns visibly available", () => {
  const html = renderToStaticMarkup(
    createElement(DepositModuleControls, {
      state: {
        policy: { roomAdvanceEnabled: false, securityDepositEnabled: false, version },
        available: true,
        securityReady: true,
      },
      onChange: () => {},
      disabled: false,
    }),
  );
  expect(html).toContain("Checkout payments remain available.");
  expect(html).toContain("Existing records can still be settled or returned.");
  expect(html.match(/role="switch"[^>]*checked/g)).toBeNull();
});
