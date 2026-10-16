// Local cash custody only; browser safe. No AR, N3 balances or refund contract.
export class SecurityCashError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "SecurityCashError";
  }
}
export type SecurityPolicy = {
  amountCents: number;
  required: boolean;
  terms: string;
  version: string;
};
export type SecurityHolding = {
  id: string;
  reservationId: string;
  roomStayId: string;
  receiptNumber: string;
  originalCents: number;
  payer: string;
  recipient: string;
  storage: string;
  roomNumber: string;
  bookingReference: string;
  terms: string;
  waived: boolean;
  inspectionClear: boolean;
  openCase: boolean;
  version: string;
  createdAt: string;
  collectedBy?: string | null;
  collectedAt?: string | null;
  createdBy: string;
  heldCents: number;
  returnableCents: number;
  pendingDispositionCents: number;
  pendingReturn: null | { id: string; cents: number; recipient: string; reservedBy: string };
};
export type SecurityBooking = {
  available: boolean;
  enabled: boolean;
  policy: SecurityPolicy;
  holdings: SecurityHolding[];
  property?: { name: string; address: string; phone: string; email: string };
};
export type SecurityReport = {
  from: string;
  asAt: string;
  openingCents: number;
  collectionsCents: number;
  returnsCents: number;
  transfersCents: number;
  adjustmentsCents: number;
  closingCents: number;
  holdings: SecurityHolding[];
  events: Array<{
    id: string;
    holdingId: string;
    event: string;
    deltaHeld: number;
    deltaDue: number;
    actor: string;
    at: string;
    detail: Record<string, unknown>;
  }>;
};
export type SecurityStatement = {
  id: string;
  version: string;
  snapshot: SecurityReport;
  counts: Array<{ holdingId: string; cents: number }>;
  envelopeVariances?: Array<{
    holdingId: string;
    expectedCents: number;
    countedCents: number;
    varianceCents: number;
  }>;
  countedCents: number;
  varianceCents: number;
  firstSigner: string;
  secondSigner: string | null;
  singlePerson: boolean;
  note: string;
  storage: string;
  status: string;
};
export type SecurityOverview = {
  policy: SecurityPolicy;
  report: SecurityReport;
  statements: SecurityStatement[];
};
export function securityMoney(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}
export const securityUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export function securityObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new SecurityCashError("security_invalid_request");
  return v as Record<string, unknown>;
}
export function securityExact(b: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(b).some((k) => !keys.includes(k)))
    throw new SecurityCashError("security_invalid_request");
}
const text = (v: unknown, max = 500) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const cents = (v: unknown, zero = false) =>
  typeof v === "number" && Number.isSafeInteger(v) && (zero ? v >= 0 : v > 0);
const version = (v: unknown) => v === "0" || securityUuid(v);
export function parseSecurityPolicy(value: unknown): SecurityPolicy {
  const b = securityObject(value);
  securityExact(b, ["amountCents", "required", "terms", "version"]);
  if (
    !cents(b.amountCents) ||
    typeof b.required !== "boolean" ||
    !text(b.terms, 1500) ||
    !version(b.version)
  )
    throw new SecurityCashError("security_invalid_policy");
  return b as SecurityPolicy;
}
const fields: Record<string, string[]> = {
  collect: ["roomStayId", "payer", "recipient", "storage", "method", "policyVersion"],
  waive: ["roomStayId", "reason"],
  inspect: ["holdingId", "version", "clear", "evidence"],
  reserve_return: ["holdingId", "version", "recipient"],
  confirm_return: ["holdingId", "version", "operationId", "recipient", "acknowledgment", "reason"],
  release_return: ["holdingId", "version", "operationId", "reason"],
  deduct: ["holdingId", "version", "cents", "reason", "evidence", "acknowledgment", "disputed"],
  restore_due: ["holdingId", "version", "cents", "reason", "evidence", "acknowledgment"],
  adjust: ["holdingId", "version", "cents", "actualCountCents", "reason", "evidence"],
  transfer: [
    "holdingId",
    "version",
    "cents",
    "reason",
    "evidence",
    "accountantReference",
    "acknowledgment",
  ],
  storage: ["holdingId", "version", "storage", "reason", "evidence"],
  authorize_recipient: ["holdingId", "version", "recipient", "reason", "evidence"],
  inspection_waiver: ["holdingId", "version", "reason", "evidence"],
  open_case: ["holdingId", "version", "kind", "reason", "evidence"],
  resolve_case: ["holdingId", "version", "reason", "evidence"],
  bank_return_record: [
    "holdingId",
    "version",
    "reason",
    "evidence",
    "acknowledgment",
    "accountantReference",
    "cashDispositionEvidence",
  ],
};
export function parseSecurityCommand(value: unknown): Record<string, unknown> {
  const b = securityObject(value),
    a = b.action;
  if (typeof a !== "string" || !fields[a]) throw new SecurityCashError("security_invalid_request");
  securityExact(b, ["action", ...fields[a]]);
  for (const key of fields[a]) {
    const v = b[key];
    if (
      (key === "reason" && a === "confirm_return") ||
      (key === "acknowledgment" && ["deduct", "transfer"].includes(a))
    ) {
      if (v !== undefined && v !== "" && !text(v))
        throw new SecurityCashError("security_invalid_request");
      continue;
    }
    if (key === "method") {
      if (v !== "cash") throw new SecurityCashError("security_cash_only");
    } else if (["holdingId", "roomStayId", "operationId"].includes(key)) {
      if (!securityUuid(v)) throw new SecurityCashError("security_invalid_request");
    } else if (key === "policyVersion") {
      if (!version(v)) throw new SecurityCashError("security_invalid_request");
    } else if (key === "version") {
      if (!securityUuid(v)) throw new SecurityCashError("security_invalid_request");
    } else if (["clear", "disputed"].includes(key)) {
      if (typeof v !== "boolean") throw new SecurityCashError("security_invalid_request");
    } else if (key === "cents") {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v === 0 || (a !== "adjust" && v < 0))
        throw new SecurityCashError("security_invalid_amount");
    } else if (key === "actualCountCents") {
      if (!cents(v, true)) throw new SecurityCashError("security_invalid_amount");
    } else if (!text(v)) throw new SecurityCashError("security_invalid_request");
  }
  return b;
}
export function parseSecurityStatement(value: unknown): Record<string, unknown> {
  const b = securityObject(value);
  if (b.action === "sign") {
    securityExact(b, ["action", "statementId", "version", "acknowledgment"]);
    if (!securityUuid(b.statementId) || !securityUuid(b.version) || !text(b.acknowledgment))
      throw new SecurityCashError("security_invalid_request");
  } else if (b.action === "count") {
    securityExact(b, ["action", "from", "counts", "singlePerson", "note", "storage"]);
    if (
      !validSecurityDate(b.from) ||
      typeof b.singlePerson !== "boolean" ||
      !text(b.storage) ||
      typeof b.note !== "string" ||
      b.note.length > 500 ||
      !Array.isArray(b.counts)
    )
      throw new SecurityCashError("security_invalid_count");
    for (const v of b.counts) {
      const c = securityObject(v);
      securityExact(c, ["holdingId", "cents"]);
      if (!securityUuid(c.holdingId) || !cents(c.cents, true))
        throw new SecurityCashError("security_invalid_count");
    }
  } else throw new SecurityCashError("security_invalid_request");
  return b;
}
export const validSecurityDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
export const SECURITY_ERRORS: Record<string, string> = {
  security_unavailable: "Security cash is not installed or cannot be read. Contact the Owner.",
  security_policy_changed:
    "The security amount or terms changed. Reload, recount the cash and review the current policy before collecting.",
  security_collection_disabled:
    "New security collections are off. Existing cash can still be returned.",
  security_collection_required:
    "Collect security cash for each room, or ask the Owner to record a waiver, before check-in.",
  security_return_required:
    "Return security cash first. For a guest who has left or a dispute, ask the Owner to record an unresolved custody case.",
  security_return_pending:
    "A cash return is already reserved. Check the envelope and signed paper with the Owner; do not pay again.",
  security_version_conflict:
    "This cash record changed. Reload and check its current state before continuing.",
  security_key_conflict:
    "This request key belongs to different details. Reload and review the saved record.",
  security_inspection_required:
    "Record a clear room/key inspection, or obtain an Owner inspection waiver.",
  security_recipient_mismatch:
    "Recipient does not match the saved authority. Ask the Owner to verify and record an exception.",
  security_owner_reconciliation_required:
    "The Owner must check the signed paper and actual cash before confirming another staff member’s handover.",
  security_identity_changed: "The property or staff session changed. Reload before recording cash.",
  security_transfer_unproven:
    "Only undisputed approved deductions can be moved. Record actual movement evidence and an accountant reference.",
  security_case_unresolved:
    "This case still holds cash. Resolve the actual return or disposition first.",
  security_invalid_count:
    "Count every envelope once using actual cash amounts. Reload if the holdings changed.",
  security_second_signer_required:
    "A different staff member must sign, or the Owner must review a single-person count.",
};
export const securityMessage = (code: string) =>
  SECURITY_ERRORS[code] ??
  "Unable to record this custody action. Reload the record and ask the Owner to review the cash and supporting paper.";

export function securityCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export const securityCountHoldings = (holdings: SecurityHolding[]) =>
  holdings.filter((h) => h.heldCents > 0 || h.pendingReturn !== null || h.openCase);
