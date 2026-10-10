import { beforeEach, expect, it, vi } from "vitest";
import type { AutomationRequestRow } from "../receipt-automation-store.server";
const state = vi.hoisted(() => ({
  policy: { revision: "2", depositApprovalRequired: true, contactApprovalRequired: false },
  unavailable: false,
}));
vi.mock("../receipt-controls-store.server", () => ({ toDTOs: async () => [{}] }));
vi.mock("../receipt-controls-deps.server", () => ({ defaultReceiptControlDeps: () => ({}) }));
vi.mock("../n3-receipt-update.server", () => ({
  productionUpdateContract: () => ({}),
  updateN3Receipt: vi.fn(),
}));
vi.mock("../receipt-automation-gates.server", () => ({ canAutoUpdate: () => true }));
vi.mock("../hotel-change-controls-store.server", () => ({
  requireFreshChangeOwner: vi.fn(),
  readChangePolicy: async () => {
    if (state.unavailable) throw new Error("policy unavailable");
    return state.policy;
  },
  changeAdmin: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { n3_tenant_key: "TEST" }, error: null }) }),
      }),
    }),
  }),
}));
import { toAutomationDTO } from "../receipt-automation-deps.server";
const actor = { tenantId: "t", n3UserKey: "u", n3Token: "test", role: "owner" as const };
const row = (deposit = true, originalApproval = false) =>
  ({
    generation: 2,
    state: "needs_review",
    attempt: null,
    automation: {
      generation: 2,
      categories: { deposit, contact: !deposit },
      policy: {
        revision: "1",
        depositApprovalRequired: originalApproval,
        contactApprovalRequired: originalApproval,
      },
      authorizationKind: null,
      authorizedAt: null,
      authorizedBy: null,
    },
  }) as AutomationRequestRow;
beforeEach(() => {
  state.policy = { revision: "2", depositApprovalRequired: true, contactApprovalRequired: false };
  state.unavailable = false;
});
it("offers Approve after deposit policy tightens without rewriting creation policy", async () => {
  const dto = await toAutomationDTO(actor, row());
  expect(dto).toMatchObject({ canApprove: true, canApply: false });
  expect(dto.automation?.policy.depositApprovalRequired).toBe(false);
});
it("offers Approve after contact policy tightens", async () => {
  state.policy.contactApprovalRequired = true;
  expect(await toAutomationDTO(actor, row(false))).toMatchObject({
    canApprove: true,
    canApply: false,
  });
});
it("retains a creation-time approval requirement when current policy relaxes", async () => {
  state.policy.depositApprovalRequired = false;
  expect(await toAutomationDTO(actor, row(true, true))).toMatchObject({
    canApprove: true,
    canApply: false,
  });
});
it("fails closed when current approval policy cannot be read", async () => {
  state.unavailable = true;
  await expect(toAutomationDTO(actor, row())).rejects.toThrow("policy unavailable");
});
