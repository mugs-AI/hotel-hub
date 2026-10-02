// Browser-safe receipt contact formatter shared by deposit creation and
// receipt-control proposals. Address -> Remarks 1-2, phone -> Remark 3,
// email -> Remark 4; each remark holds at most 100 UTF-16 units. Excess
// length is rejected, never truncated.

export type ReceiptContactFields = {
  customerName: string;
  remark1: string;
  remark2: string;
  remark3: string;
  remark4: string;
};

export const RECEIPT_REMARK_LIMIT = 100;

export class ReceiptContactError extends Error {
  code: "receipt_contact_too_long" | "receipt_contact_unavailable";
  constructor(code: ReceiptContactError["code"]) {
    super(code);
    this.code = code;
    this.name = "ReceiptContactError";
  }
}

const clean = (value: unknown) =>
  (typeof value === "string" ? value : "").trim().replace(/\s+/g, " ");

export function formatReceiptContact(details: {
  name?: string | null;
  company?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}): ReceiptContactFields {
  const customerName = [clean(details.company), clean(details.name)].filter(Boolean).join(", ");
  const address = clean(details.address),
    phone = clean(details.phone),
    email = clean(details.email);
  if (!customerName) throw new ReceiptContactError("receipt_contact_unavailable");
  // Count conservatively in UTF-16 code units and never split a surrogate pair.
  let cut = RECEIPT_REMARK_LIMIT;
  const hi = address.charCodeAt(RECEIPT_REMARK_LIMIT - 1);
  if (hi >= 0xd800 && hi <= 0xdbff) cut = RECEIPT_REMARK_LIMIT - 1;
  if (
    address.length > cut + RECEIPT_REMARK_LIMIT ||
    phone.length > RECEIPT_REMARK_LIMIT ||
    email.length > RECEIPT_REMARK_LIMIT
  )
    throw new ReceiptContactError("receipt_contact_too_long");
  return {
    customerName,
    remark1: address.slice(0, cut),
    remark2: address.slice(cut),
    remark3: phone,
    remark4: email,
  };
}
