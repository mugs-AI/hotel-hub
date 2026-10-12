import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
vi.mock("../session-client", () => ({
  useSessionMe: () => ({
    data: {
      authenticated: true,
      tenant: { tenantId: "t" },
      user: { n3UserKey: "staff" },
      role: "front_desk",
    },
  }),
}));
import { ReceiptCorrectionRecovery } from "../../components/ReceiptCorrectionRecovery";
import type { ReceiptAutomationDTO } from "../receipt-automation";
const request = {
  id: "r",
  state: "needs_review",
  version: 4,
  canApply: false,
  canCheckResult: true,
  outcomeMessage: "Result is held.",
  automation: { generation: 2 },
} as ReceiptAutomationDTO;
const render = (r: ReceiptAutomationDTO) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ReceiptCorrectionRecovery, { request: r }),
    ),
  );
it("shows read-only recovery in the reservation for held direct corrections", () => {
  expect(render(request)).toContain("Check N3 result");
  expect(render(request)).not.toContain("Dashboard");
});
it("offers explicit pre-dispatch retry only when server grants Apply", () => {
  expect(render({ ...request, canApply: true, canCheckResult: false })).toContain(
    "Apply saved correction",
  );
  expect(render({ ...request, canApply: false, canCheckResult: false })).not.toContain(
    "Apply saved correction",
  );
});
it("legacy requests cannot gain automatic recovery", () => {
  expect(render({ ...request, automation: null })).toBe("");
});
