// Effective receipts — pure, browser-safe projection shared by deposits,
// reservation list, folio, print and checkout. Only VERIFIED receipt versions
// change an amount; approval alone never does. Stored creation records are
// never mutated.
import { centsToAmount } from "./folio-money";
import type { ReceiptPaymentLine } from "./receipt-controls";

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
};

export type ReceiptOverlay =
  | {
      state: "active";
      amountCents: number;
      receiptId: string;
      docCode: string;
      paymentLines: ReceiptPaymentLine[];
      verifiedAt: string;
      replacementOf: string | null;
    }
  | { state: "voided"; verifiedAt: string }
  | {
      state: "needs_review";
      amountCents: number | null;
      receiptId: string | null;
      docCode: string | null;
    };

export type EffectiveState = "active" | "voided" | "needs_review";

/**
 * Collapse verified versions per deposit. A replacement counts only after the
 * original's void is confirmed; a confirmed void excludes the original even
 * when the replacement failed. Unresolved requests surface as Needs review and
 * keep the last confirmed figure.
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
    if (!latestOwn) continue; // replacement without confirmed void evidence never counts
    if (latestOwn.state === "voided") {
      const replacement = list
        .filter(
          (r) =>
            r.replacementOf !== null && r.state === "active" && r.versionNo > latestOwn.versionNo,
        )
        .pop();
      out.set(
        depositId,
        replacement
          ? {
              state: "active",
              amountCents: replacement.amountCents,
              receiptId: replacement.receiptId,
              docCode: replacement.docCode,
              paymentLines: replacement.paymentLines,
              verifiedAt: replacement.verifiedAt,
              replacementOf: replacement.replacementOf,
            }
          : { state: "voided", verifiedAt: latestOwn.verifiedAt },
      );
    } else {
      out.set(depositId, {
        state: "active",
        amountCents: latestOwn.amountCents,
        receiptId: latestOwn.receiptId,
        docCode: latestOwn.docCode,
        paymentLines: latestOwn.paymentLines,
        verifiedAt: latestOwn.verifiedAt,
        replacementOf: null,
      });
    }
  }
  for (const depositId of unresolvedDepositIds) {
    const prior = out.get(depositId);
    out.set(depositId, {
      state: "needs_review",
      amountCents: prior?.state === "active" ? prior.amountCents : null,
      receiptId: prior?.state === "active" ? prior.receiptId : null,
      docCode: prior?.state === "active" ? prior.docCode : null,
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
  effectiveState?: EffectiveState;
  /** Creation-time amount when an effective figure replaced it. */
  originalAmount?: number;
  effectivePaymentLines?: ReceiptPaymentLine[];
};

/** Return copies of the rows with verified effective values applied. */
export function applyEffectiveReceipts<T extends OverlayTarget>(
  rows: readonly T[],
  overlay: ReadonlyMap<string, ReceiptOverlay>,
): Array<WithEffective<T>> {
  return rows.map((row) => {
    const o = overlay.get(row.id);
    if (!o) return { ...row };
    if (o.state === "voided") return { ...row, effectiveState: "voided" as const };
    if (o.state === "needs_review") {
      if (o.amountCents === null) return { ...row, effectiveState: "needs_review" as const };
      return {
        ...row,
        amount: centsToAmount(o.amountCents),
        originalAmount: Number(row.amount),
        n3ReceiptId: o.receiptId,
        n3DocCode: o.docCode,
        effectiveState: "needs_review" as const,
      };
    }
    return {
      ...row,
      amount: centsToAmount(o.amountCents),
      originalAmount: Number(row.amount),
      n3ReceiptId: o.receiptId,
      n3DocCode: o.docCode,
      effectivePaymentLines: o.paymentLines,
      effectiveState: "active" as const,
    };
  });
}
