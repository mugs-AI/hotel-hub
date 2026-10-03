import type { HotelRole } from "./rbac";
import {
  ReceiptControlError,
  type ReceiptSnapshot,
  type ReceiptControlProposal,
} from "./receipt-controls";

export type ChangePolicy = {
  revision: string;
  depositApprovalRequired: boolean;
  contactApprovalRequired: boolean;
};
export type ChangePolicyInput = Omit<ChangePolicy, "revision"> & { expectedRevision: string };
export type ChangeCategories = { deposit: boolean; contact: boolean };
export type ChangeTarget = "n3_receipt" | "folio_bill_to";
export type ChangeRoute = "no_change" | "approval" | "owner_execution" | "direct";
export type FolioBillTo = {
  name: string;
  company: string;
  address: string;
  phone: string;
  email: string;
};
export type BillToChangeDTO = {
  id: string;
  reservationId: string;
  bookingReference: string;
  version: number;
  state: "pending" | "applied" | "rejected" | "needs_review";
  original: FolioBillTo;
  requested: FolioBillTo;
  reason: string;
  requestedByLabel: string | null;
  requestedAt: string;
  canApprove: boolean;
  canReject: boolean;
};
export type BillToReadDTO = {
  billTo: FolioBillTo;
  effectiveRevision: string;
  pending: BillToChangeDTO | null;
};
export type BillToSaveInput = {
  billTo: FolioBillTo;
  expectedRevision: string;
  clientRequestId: string;
  reason?: string;
};
export type BillToSaveResult = BillToReadDTO & { outcome: "applied" | "pending" | "no_change" };
export type ChangeRevisionDTO = { revision: string };

export function defaultChangePolicy(): ChangePolicy {
  return { revision: "0", depositApprovalRequired: true, contactApprovalRequired: false };
}

export function classifyReceiptChanges(
  original: ReceiptSnapshot,
  proposal: ReceiptControlProposal,
): ChangeCategories {
  if (proposal.kind !== "correction") throw new ReceiptControlError("automation_unavailable");
  if (original.paymentLines.length !== 1)
    throw new ReceiptControlError("split_correction_unsupported");
  return {
    deposit:
      original.amountCents !== proposal.amountCents ||
      original.paymentLines[0]!.accountId.toLowerCase() !== proposal.accountId.toLowerCase(),
    contact: (["customerName", "remark1", "remark2", "remark3", "remark4"] as const).some(
      (key) => original.contact[key] !== proposal.contact[key],
    ),
  };
}

export function routeChange(
  role: HotelRole,
  target: ChangeTarget,
  categories: ChangeCategories,
  policy: ChangePolicy,
): ChangeRoute {
  if (role !== "owner" && role !== "front_desk") throw new ReceiptControlError("forbidden");
  if (!categories.deposit && !categories.contact) return "no_change";
  if (
    (categories.deposit && policy.depositApprovalRequired) ||
    (categories.contact && policy.contactApprovalRequired)
  )
    return "approval";
  return target === "n3_receipt" && role !== "owner" ? "owner_execution" : "direct";
}
