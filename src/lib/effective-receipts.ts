// Effective receipts — pure, browser-safe projection shared by deposits,
// reservation list, folio, print and checkout. Only VERIFIED receipt versions
// change an amount; approval alone never does. Stored creation records are
// never mutated.
import { centsToAmount } from "./folio-money";
import type { ReceiptPaymentLine, ReceiptContactFields } from "./receipt-controls";

export type ReceiptVersionRow = {
  depositId: string;
  requestId: string;
  versionNo: number;
  state: "active" | "voided";
  receiptId: string;
  docCode: string;
  documentDate: string;
  currency: string;
  amountCents: number;
  paymentLines: ReceiptPaymentLine[];
  /** Original receipt id when this version is a replacement document. */
  replacementOf: string | null;
  verifiedAt: string;
  verifiedContact?: ReceiptContactFields | null;
};

/**
 * Confirmed financial contribution, kept SEPARATE from the Needs review flag.
 * `confirmed` is what verified N3 evidence proves; `needsReview` only warns.
 * A Needs review warning never resurrects a receipt whose void was confirmed.
 */
export type ReceiptOverlay = {
  confirmed:
    | {
        state: "active";
        amountCents: number;
        receiptId: string;
        docCode: string;
        paymentLines: ReceiptPaymentLine[];
        verifiedAt: string;
        replacementOf: string | null;
        verifiedContact?: ReceiptContactFields | null;
      }
    | { state: "voided"; verifiedAt: string }
    /** No verified version yet: the original creation record still applies. */
    | { state: "original" };
  needsReview: boolean;
};

export type EffectiveState = "active" | "voided";

/**
 * Collapse verified versions per deposit.
 * - A replacement counts only after the original's void is confirmed.
 * - A confirmed void excludes the original even when the replacement failed.
 * - Only the LATEST replacement row counts, once; a later voided replacement
 *   is never revived by an earlier active row of the same chain.
 * - Unresolved requests add a Needs review warning without changing the
 *   confirmed contribution.
 */
export function computeReceiptOverlay(
  versions: readonly ReceiptVersionRow[],
  unresolvedDepositIds: ReadonlySet<string>,
): Map<string, ReceiptOverlay> {
  const byDeposit = new Map<string, ReceiptVersionRow[]>();
  for (const row of versions) {
    const list = byDeposit.get(row.depositId) ?? [];
    list.push(row);
    byDeposit.set(row.depositId, list);
  }
  const out = new Map<string, ReceiptOverlay>();
  for (const [depositId, list] of byDeposit) {
    list.sort((a, b) => a.versionNo - b.versionNo);
    const own = list.filter((r) => r.replacementOf === null);
    const latestOwn = own[own.length - 1];
    if (!latestOwn) {
      // Replacement without confirmed void evidence never counts.
      out.set(depositId, { confirmed: { state: "original" }, needsReview: true });
      continue;
    }
    if (latestOwn.state === "voided") {
      const latestReplacement = list
        .filter((r) => r.replacementOf !== null && r.versionNo > latestOwn.versionNo)
        .pop();
      out.set(depositId, {
        needsReview: false,
        confirmed:
          latestReplacement && latestReplacement.state === "active"
            ? {
                state: "active",
                amountCents: latestReplacement.amountCents,
                receiptId: latestReplacement.receiptId,
                docCode: latestReplacement.docCode,
                paymentLines: latestReplacement.paymentLines,
                verifiedAt: latestReplacement.verifiedAt,
                replacementOf: latestReplacement.replacementOf,
                verifiedContact: latestReplacement.verifiedContact,
              }
            : {
                state: "voided",
                verifiedAt: (latestReplacement ?? latestOwn).verifiedAt,
              },
      });
    } else {
      out.set(depositId, {
        needsReview: false,
        confirmed: {
          state: "active",
          amountCents: latestOwn.amountCents,
          receiptId: latestOwn.receiptId,
          docCode: latestOwn.docCode,
          paymentLines: latestOwn.paymentLines,
          verifiedAt: latestOwn.verifiedAt,
          replacementOf: null,
          verifiedContact: latestOwn.verifiedContact,
        },
      });
    }
  }
  for (const depositId of unresolvedDepositIds) {
    const prior = out.get(depositId);
    out.set(depositId, {
      confirmed: prior?.confirmed ?? { state: "original" },
      needsReview: true,
    });
  }
  return out;
}

type OverlayTarget = {
  id: string;
  amount: number | string;
  n3ReceiptId: string | null;
  n3DocCode: string | null;
};

export type WithEffective<T> = T & {
  /** Confirmed state; undefined means the original record applies. */
  effectiveState?: EffectiveState;
  /** Warning only — never changes the confirmed contribution. */
  needsReview?: boolean;
  /** Creation-time amount when an effective figure replaced it. */
  originalAmount?: number;
  effectivePaymentLines?: ReceiptPaymentLine[];
  effectiveContact?: ReceiptContactFields;
};

/** Return copies of the rows with verified effective values applied. */
export function applyEffectiveReceipts<T extends OverlayTarget>(
  rows: readonly T[],
  overlay: ReadonlyMap<string, ReceiptOverlay>,
): Array<WithEffective<T>> {
  return rows.map((row) => {
    const o = overlay.get(row.id);
    if (!o) return { ...row };
    const flag = o.needsReview ? { needsReview: true as const } : {};
    const c = o.confirmed;
    if (c.state === "original") return { ...row, ...flag };
    if (c.state === "voided") return { ...row, ...flag, effectiveState: "voided" as const };
    return {
      ...row,
      ...flag,
      amount: centsToAmount(c.amountCents),
      originalAmount: Number(row.amount),
      n3ReceiptId: c.receiptId,
      n3DocCode: c.docCode,
      effectivePaymentLines: c.paymentLines,
      ...(c.verifiedContact ? { effectiveContact: c.verifiedContact } : {}),
      effectiveState: "active" as const,
    };
  });
}
