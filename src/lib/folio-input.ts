// HH-GOLIVE-01A — API-boundary validation for every folio mutation.
//
// Pure and shared by routes and tests. Nothing reaches the store until the
// shape, the enums and the ranges are proven here. Unknown fields are
// rejected outright so a typo can never be silently ignored.
import { isTaxClass, type TaxClass } from "./charges-catalogue";
import { isGuestTaxClass, type GuestTaxClass } from "./folio";

export type Invalid = { ok: false; code: string };
export type Valid<T> = { ok: true; value: T };
export type Checked<T> = Valid<T> | Invalid;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject any field the endpoint does not explicitly accept. */
export function onlyKnownFields(body: unknown, allowed: readonly string[]): Invalid | null {
  if (!isPlainObject(body)) return { ok: false, code: "invalid_body" };
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return { ok: false, code: "unknown_field" };
  }
  return null;
}

function reason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 3 && t.length <= 240 ? t : null;
}

function quantity(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 9999 ? v : null;
}

// ------------------------------------------------------------ add-on line

export type AddonLineBody = {
  catalogueId: string;
  quantity: number;
  unitPriceCents?: number;
  reason?: string;
  clientRequestId: string;
};

const ADDON_FIELDS = [
  "catalogueId",
  "quantity",
  "unitPriceCents",
  "reason",
  "clientRequestId",
] as const;

export function validateAddonLineBody(body: unknown): Checked<AddonLineBody> {
  const unknown = onlyKnownFields(body, ADDON_FIELDS);
  if (unknown) return unknown;
  const b = body as Record<string, unknown>;
  if (!isUuidLike(b.clientRequestId)) return { ok: false, code: "invalid_client_request_id" };
  if (!isUuidLike(b.catalogueId)) return { ok: false, code: "invalid_catalogue_id" };
  const qty = quantity(b.quantity);
  if (qty === null) return { ok: false, code: "invalid_quantity" };

  const value: AddonLineBody = {
    catalogueId: b.catalogueId,
    quantity: qty,
    clientRequestId: b.clientRequestId,
  };
  if (b.unitPriceCents !== undefined && b.unitPriceCents !== null) {
    const p = b.unitPriceCents;
    if (typeof p !== "number" || !Number.isSafeInteger(p) || p < 0 || p > 1e9) {
      return { ok: false, code: "invalid_unit_price" };
    }
    value.unitPriceCents = p;
  }
  if (b.reason !== undefined && b.reason !== null) {
    const r = reason(b.reason);
    if (r === null) return { ok: false, code: "reason_required" };
    value.reason = r;
  }
  return { ok: true, value };
}

// ----------------------------------------------------------- quantity edit

export function validateQuantityBody(body: unknown): Checked<{ quantity: number }> {
  const unknown = onlyKnownFields(body, ["quantity"]);
  if (unknown) return unknown;
  const qty = quantity((body as Record<string, unknown>).quantity);
  if (qty === null) return { ok: false, code: "invalid_quantity" };
  return { ok: true, value: { quantity: qty } };
}

// -------------------------------------------------------------- reversal

export function validateReverseBody(
  body: unknown,
): Checked<{ reason: string; clientRequestId: string }> {
  const unknown = onlyKnownFields(body, ["reason", "clientRequestId"]);
  if (unknown) return unknown;
  const b = body as Record<string, unknown>;
  if (!isUuidLike(b.clientRequestId)) return { ok: false, code: "invalid_client_request_id" };
  const r = reason(b.reason);
  if (r === null) return { ok: false, code: "reason_required" };
  return { ok: true, value: { reason: r, clientRequestId: b.clientRequestId } };
}

// ------------------------------------------------------------- adjustment

export type AdjustmentBody = {
  lineType: "discount" | "manual_adjustment";
  description: string;
  amountCents: number;
  taxClass: TaxClass | null;
  reason: string;
  clientRequestId: string;
};

const ADJUSTMENT_FIELDS = [
  "lineType",
  "description",
  "amountCents",
  "taxClass",
  "reason",
  "clientRequestId",
] as const;

export function validateAdjustmentBody(body: unknown): Checked<AdjustmentBody> {
  const unknown = onlyKnownFields(body, ADJUSTMENT_FIELDS);
  if (unknown) return unknown;
  const b = body as Record<string, unknown>;
  if (!isUuidLike(b.clientRequestId)) return { ok: false, code: "invalid_client_request_id" };
  if (b.lineType !== "discount" && b.lineType !== "manual_adjustment") {
    return { ok: false, code: "invalid_line_type" };
  }
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!description || description.length > 160) return { ok: false, code: "invalid_description" };
  const amount = b.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || Math.abs(amount) > 1e9) {
    return { ok: false, code: "invalid_amount" };
  }
  if (amount === 0) return { ok: false, code: "invalid_amount" };
  if (b.lineType === "discount" && amount > 0) return { ok: false, code: "invalid_amount" };
  // A tax class is an ENUM, never free text. Absent means "no class".
  let taxClass: TaxClass | null = null;
  if (b.taxClass !== undefined && b.taxClass !== null) {
    if (!isTaxClass(b.taxClass)) return { ok: false, code: "invalid_tax_class" };
    taxClass = b.taxClass;
  }
  const r = reason(b.reason);
  if (r === null) return { ok: false, code: "reason_required" };
  return {
    ok: true,
    value: {
      lineType: b.lineType,
      description,
      amountCents: amount,
      taxClass,
      reason: r,
      clientRequestId: b.clientRequestId,
    },
  };
}

// ------------------------------------------------------------ tax profile

export function validateTaxProfileBody(
  body: unknown,
): Checked<{ guestTaxClass: GuestTaxClass; evidenceNote: string | null }> {
  const unknown = onlyKnownFields(body, ["guestTaxClass", "evidenceNote"]);
  if (unknown) return unknown;
  const b = body as Record<string, unknown>;
  if (!isGuestTaxClass(b.guestTaxClass)) return { ok: false, code: "invalid_guest_tax_class" };
  let note: string | null = null;
  if (b.evidenceNote !== undefined && b.evidenceNote !== null) {
    if (typeof b.evidenceNote !== "string" || b.evidenceNote.trim().length > 240) {
      return { ok: false, code: "invalid_evidence_note" };
    }
    note = b.evidenceNote.trim() || null;
  }
  return { ok: true, value: { guestTaxClass: b.guestTaxClass, evidenceNote: note } };
}

// ------------------------------------------------- tourism tax evidence

export type EvidenceBody = {
  sourceLabel: string;
  reference: string | null;
  collectedOn: string | null;
  amountCents: number;
  note: string | null;
  clientRequestId: string;
};

const EVIDENCE_FIELDS = [
  "sourceLabel",
  "reference",
  "collectedOn",
  "amountCents",
  "note",
  "clientRequestId",
] as const;

export function validateEvidenceBody(body: unknown): Checked<EvidenceBody> {
  const unknown = onlyKnownFields(body, EVIDENCE_FIELDS);
  if (unknown) return unknown;
  const b = body as Record<string, unknown>;
  if (!isUuidLike(b.clientRequestId)) return { ok: false, code: "invalid_client_request_id" };
  const sourceLabel = typeof b.sourceLabel === "string" ? b.sourceLabel.trim() : "";
  if (sourceLabel.length < 2 || sourceLabel.length > 60) {
    return { ok: false, code: "invalid_source_label" };
  }
  const amount = b.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > 1e8) {
    return { ok: false, code: "invalid_amount" };
  }
  let reference: string | null = null;
  if (b.reference !== undefined && b.reference !== null) {
    if (typeof b.reference !== "string" || b.reference.trim().length > 80) {
      return { ok: false, code: "invalid_reference" };
    }
    reference = b.reference.trim() || null;
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string" || b.note.trim().length > 240) {
      return { ok: false, code: "invalid_note" };
    }
    note = b.note.trim() || null;
  }
  let collectedOn: string | null = null;
  if (b.collectedOn !== undefined && b.collectedOn !== null) {
    if (typeof b.collectedOn !== "string" || !ISO_DATE_RE.test(b.collectedOn)) {
      return { ok: false, code: "invalid_collected_on" };
    }
    collectedOn = b.collectedOn;
  }
  return {
    ok: true,
    value: { sourceLabel, reference, collectedOn, amountCents: amount, note, clientRequestId: b.clientRequestId },
  };
}
