// Notification status for a receipt request. External alert transport is not
// configured, so nothing is sent; the status says so plainly.
import type { ReceiptControlRequestDTO } from "@/lib/receipt-controls";

export function receiptAlertLabel(alert: ReceiptControlRequestDTO["alert"]): string {
  if (!alert) return "Notification: none";
  switch (alert.status) {
    case "sent":
      return "Notification: sent";
    case "failed":
      return "Notification: failed — will retry";
    case "pending":
      return "Notification: queued (no alert channel set up — not sent)";
    default:
      return "Notification: not sent — no alert channel set up";
  }
}

export function ReceiptAlertStatus({ alert }: { alert: ReceiptControlRequestDTO["alert"] }) {
  return <p className="text-xs text-muted-foreground">{receiptAlertLabel(alert)}</p>;
}
