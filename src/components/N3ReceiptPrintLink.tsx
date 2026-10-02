/** Opens the original N3 receipt. N3's Preview/Print produces the voucher. */
export function N3ReceiptPrintLink({
  status,
  receiptId,
}: {
  status: string;
  receiptId: string | null;
}) {
  if (
    status !== "posted" ||
    !receiptId ||
    receiptId === "00000000-0000-0000-0000-000000000000" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId)
  )
    return null;
  return (
    <a
      href={`https://n3.qne.cloud/ar/or/detail/${receiptId}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens the original receipt in N3. Use Preview, then Print."
      className="rounded-md border border-input bg-white px-2 py-1.5 text-sm font-medium hover:bg-accent"
    >
      Print in N3
    </a>
  );
}
