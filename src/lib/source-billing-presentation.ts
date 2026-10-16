// Browser-safe allowlisted display projection. Inputs come from the scoped server.
import type { BillingLegSnapshot } from "./source-billing";
import { MAX_MONEY_CENTS } from "./checkout-money";
import { isN3Guid } from "./n3-guid";
export type VerifiedLegDisplay = {
  legId: string;
  snapshotDigest: string;
  hhNumber: string;
  n3Number: string;
  n3Id: string;
  checkedAt: string;
  status: "issued" | "paid" | "unavailable";
  documentType: "sales_invoice" | "cash_sale";
};
export type SourceBillPresentation = {
  title: string;
  configuredTitle: string;
  documentKind: "accommodation_statement" | "guest_statement" | "accounting_copy";
  documentDate: string;
  currency: string;
  showPrices: boolean;
  status: VerifiedLegDisplay["status"];
  notice: string;
  document: {
    hhNumber: string;
    n3Number: string;
    n3Id: string;
    type: VerifiedLegDisplay["documentType"];
  } | null;
  rows: Array<{
    description: string;
    quantity: number;
    unitPrice: number | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
  }>;
  total: number | null;
};
const cents = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= MAX_MONEY_CENTS;
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export function presentSourceBill(
  leg: BillingLegSnapshot,
  verified: VerifiedLegDisplay | null,
  audience: "guest" | "accounting",
): SourceBillPresentation {
  const s = leg.snapshot;
  if (
    !["guest", "accounting"].includes(audience) ||
    !["guest", "source_room"].includes(leg.kind) ||
    !date(s.billDate) ||
    !/^[A-Z]{3}$/.test(s.currency) ||
    !cents(s.totalCents) ||
    s.totalCents <= 0 ||
    !s.lines.length ||
    s.lines.some(
      (l) =>
        ![l.unitCents, l.subtotalCents, l.taxCents, l.totalCents].every(cents) ||
        !Number.isInteger(l.qty) ||
        l.qty <= 0 ||
        l.subtotalCents !== l.qty * l.unitCents ||
        l.totalCents !== l.subtotalCents + l.taxCents,
    ) ||
    s.lines.reduce((n, l) => n + l.totalCents, 0) !== s.totalCents
  )
    throw Error("source_bill_presentation_invalid");
  const source = leg.kind === "source_room",
    showPrices = audience === "accounting" || !source || leg.showPrices;
  const checked =
    verified &&
    verified.legId === leg.legId &&
    verified.snapshotDigest === s.digest &&
    isN3Guid(verified.n3Id) &&
    /^[A-Z]{2}\d{9}$/.test(verified.hhNumber) &&
    !!verified.n3Number.trim() &&
    verified.n3Number.length <= 100 &&
    Number.isFinite(Date.parse(verified.checkedAt)) &&
    ["issued", "paid"].includes(verified.status) &&
    ["sales_invoice", "cash_sale"].includes(verified.documentType)
      ? verified
      : null;
  const title =
    source && audience === "guest"
      ? leg.documentTitle
      : checked?.documentType === "cash_sale"
        ? "Cash Sale"
        : "Sales Invoice";
  return freeze({
    title,
    configuredTitle: leg.documentTitle,
    documentKind:
      source && audience === "guest"
        ? "accommodation_statement"
        : audience === "accounting"
          ? "accounting_copy"
          : "guest_statement",
    documentDate: s.billDate,
    currency: s.currency,
    showPrices,
    status: checked?.status ?? "unavailable",
    notice:
      source && audience === "guest"
        ? "Accommodation charges are handled by the booking source. This is a guest statement."
        : checked
          ? "Accounting document details verified in N3."
          : "Preparation only — an issued N3 document has not been verified.",
    document: checked
      ? {
          hhNumber: checked.hhNumber,
          n3Number: checked.n3Number,
          n3Id: checked.n3Id,
          type: checked.documentType,
        }
      : null,
    rows: s.lines.map((l) => ({
      description: source && audience === "guest" ? leg.itemDescription : l.description,
      quantity: l.qty,
      unitPrice: showPrices ? l.unitCents / 100 : null,
      subtotal: showPrices ? l.subtotalCents / 100 : null,
      tax: showPrices ? l.taxCents / 100 : null,
      total: showPrices ? l.totalCents / 100 : null,
    })),
    total: showPrices ? s.totalCents / 100 : null,
  });
}
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
/** Exact allowlisted HTML; private monetary values are absent from the DTO itself,
 * rather than hidden with CSS. Custom source titles do not rename N3 documents. */
export function renderSourceBillHtml(v: SourceBillPresentation): string {
  const amount = (n: number | null) => (n === null ? "" : n.toFixed(2));
  const day =
    v.documentDate.slice(8, 10) +
    "/" +
    v.documentDate.slice(5, 7) +
    "/" +
    v.documentDate.slice(0, 4);
  const moneyHead = v.showPrices
    ? "<th>Unit price</th><th>Subtotal</th><th>Tax</th><th>Total</th>"
    : "";
  const rows = v.rows
    .map(
      (r) =>
        `<tr><td>${escape(r.description)}</td><td>${r.quantity}</td>${v.showPrices ? `<td>${amount(r.unitPrice)}</td><td>${amount(r.subtotal)}</td><td>${amount(r.tax)}</td><td>${amount(r.total)}</td>` : ""}</tr>`,
    )
    .join("");
  const identity = v.document
    ? `<p>HH ${escape(v.document.hhNumber)} · N3 ${escape(v.document.n3Number)}</p>`
    : "";
  const unavailable =
    v.status === "unavailable" ? "<p>Preparation only — no verified final invoice.</p>" : "";
  return `<article><h1>${escape(v.title)}</h1><p>${escape(day)} · ${escape(v.currency)}</p>${identity}${unavailable}<p>${escape(v.notice)}</p><table><thead><tr><th>Description</th><th>Quantity</th>${moneyHead}</tr></thead><tbody>${rows}</tbody></table>${v.showPrices ? `<p>Total ${escape(v.currency)} ${amount(v.total)}</p>` : ""}</article>`;
}
