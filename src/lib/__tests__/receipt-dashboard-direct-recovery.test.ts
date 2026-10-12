import { expect, it } from "vitest";
import { needsDashboardReceiptAction } from "../../components/ReceiptApprovalQueue";
const direct = {
  automation: {
    generation: 2,
    authorizationKind: "direct_policy",
    policy: { depositApprovalRequired: false, contactApprovalRequired: false },
  },
  canApprove: false,
};
it("keeps failed approval-OFF corrections in their reservation", () => {
  expect(needsDashboardReceiptAction(direct)).toBe(false);
});
it("preserves real Owner approval after policy tightening", () => {
  expect(needsDashboardReceiptAction({ ...direct, canApprove: true })).toBe(true);
});
it("preserves legacy review and approval-ON requests", () => {
  expect(needsDashboardReceiptAction({ automation: null, canApprove: false })).toBe(true);
  expect(
    needsDashboardReceiptAction({
      ...direct,
      automation: {
        ...direct.automation,
        policy: { depositApprovalRequired: true, contactApprovalRequired: false },
      },
    }),
  ).toBe(true);
});
