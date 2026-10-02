// Receipt controls — pure, browser-safe contract (DTOs, validation,
// comparison and state machine). No I/O. Server modules own evidence,
// persistence and execution.
import { formatCents } from "./folio-money";
import {
  formatReceiptContact,
  ReceiptContactError,
  type ReceiptContactFields,
} from "./receipt-contact";

export type { ReceiptContactFields } from "./receipt-contact";

export type ReceiptControlState =
  | "pending"
  | "rejected"
  | "approved_awaiting_n3"
  | "applying"
  | "applied"
  | "failed"
  | "needs_review";

export const RECEIPT_CONTROL_STATES: readonly ReceiptControlState[] = [
  "pending",
  "rejected",
  "approved_awaiting_n3",
  "applying",
  "applied",
  "failed",
  "needs_review",
];

/** States that block a second request for the same receipt. */
export const ACTIVE_RECEIPT_CONTROL_STATES: readonly ReceiptControlState[] = [
  "pending",
  "approved_awaiting_n3",
  "applying",
  "failed",
  "needs_review",
];

export type ReceiptPaymentLine = {
  accountId: string;
  code: string;
  savedName: string;
  amountCents: number;
};

export type ReceiptSnapshot = {
  receiptId: string;
  docCode: string;
  documentDate: string;
  customerId: string;
  currency: string;
  amountCents: number;
  paymentLines: ReceiptPaymentLine[];
  contact: ReceiptContactFields;
  documentState: "active" | "voided" | "unknown";
  matchingState: "unmatched" | "matched" | "refunded" | "unknown";
  sourceFingerprint: string;
  verifiedAt: string;
};

export type ReceiptControlProposal =
  | { kind: "correction"; amountCents: number; accountId: string; contact: ReceiptContactFields }
  | { kind: "void" };

export type ReceiptComparison = {
  fields: Array<{ label: string; original: string; requested: string }>;
  depositDeltaCents: number;
  balanceDeltaCents: number;
};

export type ReceiptControlExecutionMode = "manual" | "direct" | "void_replace";

export type ReceiptControlRequestDTO = {
  id: string;
  reservationId: string;
  bookingReference: string;
  depositId: string;
  reason: string;
  requestedByLabel: string | null;
  requestedAt: string;
  state: ReceiptControlState;
  version: number;
  original: ReceiptSnapshot;
  proposal: ReceiptControlProposal;
  comparison: ReceiptComparison;
  executionMode: ReceiptControlExecutionMode;
  decidedByLabel: string | null;
  decidedAt: string | null;
  selfApproved: boolean;
  canApprove: boolean;
  canReject: boolean;
  canVerify: boolean;
  outcomeMessage: string | null;
  alert: { status: "disabled" | "pending" | "sent" | "failed"; lastError: string | null } | null;
};

export type EffectiveReceipt = {
  depositId: string;
  originalReceiptId: string;
  receiptId: string;
  docCode: string;
  documentDate: string;
  currency: string;
  amountCents: number;
  paymentLines: ReceiptPaymentLine[];
  state: "active" | "voided" | "needs_review";
  verifiedAt: string | null;
  replacementOf: string | null;
  creationAmountCents: number;
};

export class ReceiptControlError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReceiptControlError";
  }
}

export const MAX_RECEIPT_CONTROL_CENTS = 100_000_000; // RM1,000,000.00
export const MAX_REASON_UNITS = 500;

export function validateReason(input: unknown): string {
  if (typeof input !== "string") throw new ReceiptControlError("invalid_reason");
  const reason = input.trim();
  if (!reason || reason.length > MAX_REASON_UNITS) throw new ReceiptControlError("invalid_reason");
  return reason;
}

function amountToCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const cents = Math.round(v * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents - v * 100) > 1e-6) return null;
  if (cents <= 0 || cents > MAX_RECEIPT_CONTROL_CENTS) return null;
  return cents;
}

const ACCOUNT_RE = /^[0-9a-fA-F-]{16,64}$/;

/** Fail-closed: unknown evidence never authorizes a request. */
export function assertReceiptControllable(original: ReceiptSnapshot) {
  if (original.documentState !== "active" || original.matchingState !== "unmatched")
    throw new ReceiptControlError("receipt_restricted");
}

export function validateReceiptControlProposal(
  input: unknown,
  original: ReceiptSnapshot,
): ReceiptControlProposal {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new ReceiptControlError("invalid_proposal");
  const body = input as Record<string, unknown>;
  const allowed = body.kind === "void" ? ["kind"] : ["kind", "amount", "accountId", "contact"];
  for (const k of Object.keys(body))
    if (!allowed.includes(k)) throw new ReceiptControlError("unknown_field");
  assertReceiptControllable(original);
  if (body.kind === "void") return { kind: "void" };
  if (body.kind !== "correction") throw new ReceiptControlError("invalid_proposal");
  if (original.paymentLines.length !== 1)
    throw new ReceiptControlError("split_correction_unsupported");
  const amountCents = amountToCents(body.amount);
  if (amountCents === null) throw new ReceiptControlError("invalid_amount");
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!ACCOUNT_RE.test(accountId)) throw new ReceiptControlError("invalid_account");
  const raw = body.contact;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ReceiptControlError("invalid_contact");
  const c = raw as Record<string, unknown>;
  for (const k of Object.keys(c))
    if (!["name", "company", "address", "phone", "email"].includes(k))
      throw new ReceiptControlError("unknown_field");
  for (const k of Object.keys(c))
    if (c[k] !== undefined && c[k] !== null && typeof c[k] !== "string")
      throw new ReceiptControlError("invalid_contact");
  let contact: ReceiptContactFields;
  try {
    contact = formatReceiptContact(c as Record<string, string>);
  } catch (e) {
    if (e instanceof ReceiptContactError) throw new ReceiptControlError(e.code);
    throw e;
  }
  const proposal: ReceiptControlProposal = { kind: "correction", amountCents, accountId, contact };
  if (compareReceiptControl(original, proposal).fields.length === 0)
    throw new ReceiptControlError("proposal_unchanged");
  return proposal;
}

const CONTACT_LABELS: Array<[keyof ReceiptContactFields, string]> = [
  ["customerName", "Bill-to name"],
  ["remark1", "Address (line 1)"],
  ["remark2", "Address (line 2)"],
  ["remark3", "Phone"],
  ["remark4", "Email"],
];

export function compareReceiptControl(
  original: ReceiptSnapshot,
  proposal: ReceiptControlProposal,
): ReceiptComparison {
  const money = (c: number) => formatCents(c, original.currency);
  if (proposal.kind === "void") {
    return {
      fields: [{ label: "Receipt", original: original.docCode, requested: "Void" }],
      depositDeltaCents: -original.amountCents,
      balanceDeltaCents: original.amountCents,
    };
  }
  const fields: ReceiptComparison["fields"] = [];
  if (proposal.amountCents !== original.amountCents)
    fields.push({
      label: "Amount",
      original: money(original.amountCents),
      requested: money(proposal.amountCents),
    });
  const line = original.paymentLines[0];
  if (!line || line.accountId.toLowerCase() !== proposal.accountId.toLowerCase())
    fields.push({
      label: "Deposit to",
      original: original.paymentLines.map((l) => l.savedName || l.code).join(", "),
      requested: proposal.accountId,
    });
  for (const [key, label] of CONTACT_LABELS)
    if (original.contact[key] !== proposal.contact[key])
      fields.push({ label, original: original.contact[key], requested: proposal.contact[key] });
  const delta = proposal.amountCents - original.amountCents;
  return { fields, depositDeltaCents: delta, balanceDeltaCents: -delta };
}

const EDGES: Record<ReceiptControlState, readonly ReceiptControlState[]> = {
  pending: ["rejected", "approved_awaiting_n3", "needs_review"],
  approved_awaiting_n3: ["applying", "needs_review", "applied"],
  applying: ["applied", "failed", "needs_review"],
  failed: ["needs_review"],
  needs_review: ["rejected", "applied"],
  applied: [],
  rejected: [],
};

/**
 * approved_awaiting_n3 → applied is only reached by Owner verification with
 * authoritative N3 readback (manual mode); it is never a browser transition.
 */
export function canTransitionReceiptControl(
  from: ReceiptControlState,
  to: ReceiptControlState,
): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export const RECEIPT_CONTROL_STATE_LABEL: Record<ReceiptControlState, string> = {
  pending: "Pending approval",
  rejected: "Rejected",
  approved_awaiting_n3: "Approved — complete in N3",
  applying: "Applying",
  applied: "Applied",
  failed: "Failed",
  needs_review: "Needs review",
};

export const MANUAL_APPROVAL_MESSAGE = "Approved. Complete the change in N3, then verify.";
