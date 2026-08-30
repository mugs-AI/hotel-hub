// HH-GOLIVE-01A — SME folio preparation card on the reservation workspace.
//
// The card is explicit that this is PREPARATION ONLY: nothing here posts to
// N3, creates a CashMemo, matches a deposit or issues a refund.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  folioErrorMessage,
  useAddFolioAdjustment,
  useAddFolioItem,
  useAddTourismTaxEvidence,
  useRefreshFolio,
  useReservationFolio,
  useReverseFolioLine,
  useSetGuestTaxClass,
  useUpdateFolioQuantity,
} from "@/lib/folio-client";
import { formatFolioMoney, type FolioLineDTO } from "@/lib/folio-view";
import { GUEST_TAX_CLASS_LABELS, GUEST_TAX_CLASSES, type GuestTaxClass } from "@/lib/folio";
import { makeRequestId } from "@/lib/idempotency";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";

export function FolioCard({ reservationId, canView }: { reservationId: string; canView: boolean }) {
  const q = useReservationFolio(reservationId, canView);
  const [open, setOpen] = useState(false);
  const addItem = useAddFolioItem(reservationId);
  const setQuantity = useUpdateFolioQuantity(reservationId);
  const reverse = useReverseFolioLine(reservationId);
  const adjust = useAddFolioAdjustment(reservationId);
  const setTaxClass = useSetGuestTaxClass(reservationId);
  const refresh = useRefreshFolio(reservationId);
  const addEvidence = useAddTourismTaxEvidence(reservationId);
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceAmount, setEvidenceAmount] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [reverseTarget, setReverseTarget] = useState<FolioLineDTO | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const dto = q.data;
  const blocking = useMemo(
    () => (dto?.blockers ?? []).filter((b) => b.severity === "blocking"),
    [dto],
  );

  if (!canView) return null;

  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${TEAL}` }}
      aria-label="Folio preparation"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: NAVY }}>
            Folio (preparation only)
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Room charges, extras and Malaysian taxes are calculated on the server. Nothing on this
            card is posted to accounting: no cash memo, no invoice, no deposit matching and no
            refund.
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Prepared total</p>
          <p className="text-base font-semibold" style={{ color: NAVY }}>
            {dto
              ? formatFolioMoney(dto.totals.grandTotal, dto.reservation.currency)
              : q.isLoading
                ? "…"
                : "—"}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-sm font-medium underline underline-offset-2"
              style={{ color: TEAL }}
            >
              {open ? "Hide details" : "Details"}
            </button>
            <Link
              to="/reservations/$id/folio-print"
              params={{ id: reservationId }}
              className="text-sm font-medium underline underline-offset-2"
              style={{ color: NAVY }}
            >
              Print folio
            </Link>
          </div>
        </div>
      </div>

      {q.error ? (
        <p className="mt-3 text-sm" style={{ color: "#C2413B" }}>
          {folioErrorMessage(q.error, "Unable to load the folio.")}
        </p>
      ) : null}

      {open && dto ? (
        <div className="mt-4 space-y-5">
          {blocking.length > 0 ? (
            <ul className="space-y-2">
              {dto.blockers.map((b) => (
                <li
                  key={b.code}
                  className="rounded-md border p-3 text-sm"
                  style={{
                    borderColor: b.severity === "blocking" ? "#F3C7C3" : "#E2E8F0",
                    backgroundColor: b.severity === "blocking" ? "#FDECEC" : "#F8FAFC",
                  }}
                >
                  {b.message}
                </li>
              ))}
            </ul>
          ) : null}

          {dto.capability.canAddItem ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refresh.isPending}
                onClick={() =>
                  refresh.mutate(undefined, {
                    onSuccess: () => toast.success("Folio prepared from the reservation."),
                    onError: (err) => toast.error(folioErrorMessage(err)),
                  })
                }
              >
                {refresh.isPending ? "Preparing…" : "Prepare / refresh room nights"}
              </Button>
              <span className="text-sm text-muted-foreground">
                Viewing a folio never changes it. Room nights are snapshotted at check-in, or here.
              </span>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {dto.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="py-2">
                      <span className={l.status === "reversed" ? "line-through" : undefined}>
                        {l.description}
                      </span>
                      {l.roomLabel ? (
                        <span className="block text-sm text-muted-foreground">
                          {l.roomLabel}
                          {l.stayDate ? ` · ${l.stayDate}` : ""}
                        </span>
                      ) : null}
                      {l.reason ? (
                        <span className="block text-sm text-muted-foreground">
                          Reason: {l.reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {l.canEditQuantity ? (
                        <input
                          type="number"
                          min={1}
                          defaultValue={l.quantity}
                          className="w-16 rounded border px-2 py-1 text-right text-sm"
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (next === l.quantity) return;
                            setQuantity.mutate(
                              { lineId: l.id, quantity: next, clientRequestId: makeRequestId() },
                              {
                                onError: (err) => toast.error(folioErrorMessage(err)),
                              },
                            );
                          }}
                        />
                      ) : (
                        l.quantity
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {formatFolioMoney(l.unitPrice, dto.reservation.currency)}
                    </td>
                    <td className="py-2 text-right">
                      {formatFolioMoney(l.amount, dto.reservation.currency)}
                    </td>
                    <td className="py-2 text-right">
                      {l.canReverse ? (
                        <button
                          type="button"
                          className="text-sm font-medium underline underline-offset-2"
                          onClick={() => {
                            setReverseTarget(l);
                            setReverseReason("");
                          }}
                        >
                          Reverse
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {dto.derived.map((d) => (
                  <tr key={d.key} className="border-t border-border text-muted-foreground">
                    <td className="py-2">{d.description}</td>
                    <td className="py-2 text-right">{d.quantity}</td>
                    <td className="py-2 text-right">
                      {formatFolioMoney(d.unitPrice, dto.reservation.currency)}
                    </td>
                    <td className="py-2 text-right">
                      {formatFolioMoney(d.amount, dto.reservation.currency)}
                    </td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Charges</dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.charges, dto.reservation.currency)}
            </dd>
            <dt className="text-muted-foreground">Service charge</dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.serviceCharge, dto.reservation.currency)}
            </dd>
            <dt className="text-muted-foreground">Service Tax</dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.serviceTax, dto.reservation.currency)}
            </dd>
            <dt className="text-muted-foreground">Tourism Tax</dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.tourismTax, dto.reservation.currency)}
            </dd>
            <dt className="text-muted-foreground">
              {dto.readiness.localLevyLabel ?? "Local levy"}
            </dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.localLevy, dto.reservation.currency)}
            </dd>
            <dt className="text-muted-foreground">Rounding</dt>
            <dd className="text-right">
              {formatFolioMoney(dto.totals.rounding, dto.reservation.currency)}
            </dd>
            <dt className="font-semibold" style={{ color: NAVY }}>
              Prepared total
            </dt>
            <dd className="text-right text-base font-semibold" style={{ color: NAVY }}>
              {formatFolioMoney(dto.totals.grandTotal, dto.reservation.currency)}
            </dd>
          </dl>

          {dto.capability.canSetTaxClass ? (
            <div className="rounded-lg border p-3" style={{ borderColor: `${NAVY}1F` }}>
              <Label className="text-sm font-semibold" style={{ color: NAVY }}>
                Guest classification (Tourism Tax)
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Malaysian citizens and permanent residents are exempt. Record the classification —
                never the identity-document number.
              </p>
              <select
                className="mt-2 rounded border px-2 py-1 text-sm"
                value={dto.guestTaxClass}
                onChange={(e) =>
                  setTaxClass.mutate(
                    { guestTaxClass: e.target.value as GuestTaxClass },
                    { onError: (err) => toast.error(folioErrorMessage(err)) },
                  )
                }
              >
                {GUEST_TAX_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {GUEST_TAX_CLASS_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {dto.capability.canManageCharges ? (
            <div className="rounded-lg border p-3" style={{ borderColor: `${NAVY}1F` }}>
              <p className="text-sm font-semibold" style={{ color: NAVY }}>
                Tourism Tax already collected by an OTA / DPSP
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Record manual evidence so the guest is credited instead of charged twice. Only the
                collecting party, a reference and the amount are stored — never card or bank data.
              </p>

              {dto.tourismTaxEvidence.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {dto.tourismTaxEvidence.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1"
                    >
                      <span>{e.sourceLabel}</span>
                      <span className="font-mono">{e.reference ?? "—"}</span>
                      <span>{e.collectedOn ?? "—"}</span>
                      <span>{formatFolioMoney(e.amount, dto.reservation.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No evidence recorded.</p>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <div>
                  <Label htmlFor="ttx-source">Collected by</Label>
                  <Input
                    id="ttx-source"
                    value={evidenceLabel}
                    onChange={(e) => setEvidenceLabel(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ttx-ref">Reference</Label>
                  <Input
                    id="ttx-ref"
                    value={evidenceReference}
                    onChange={(e) => setEvidenceReference(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ttx-date">Collected on</Label>
                  <MalaysianDateInput
                    id="ttx-date"
                    value={evidenceDate}
                    pickerLabel="Choose the collection date"
                    onChange={setEvidenceDate}
                  />
                </div>
                <div>
                  <Label htmlFor="ttx-amount">Amount</Label>
                  <Input
                    id="ttx-amount"
                    inputMode="decimal"
                    value={evidenceAmount}
                    onChange={(e) => setEvidenceAmount(e.target.value)}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={addEvidence.isPending}
                onClick={() => {
                  const amount = Number(evidenceAmount);
                  if (!Number.isFinite(amount) || amount < 0) {
                    toast.error("Enter the amount that was already collected.");
                    return;
                  }
                  addEvidence.mutate(
                    {
                      sourceLabel: evidenceLabel.trim(),
                      reference: evidenceReference.trim() || null,
                      collectedOn: evidenceDate || null,
                      amountCents: Math.round(amount * 100),
                      clientRequestId: makeRequestId(),
                    },
                    {
                      onSuccess: () => {
                        setEvidenceLabel("");
                        setEvidenceAmount("");
                        setEvidenceReference("");
                        setEvidenceDate("");
                        toast.success("Tourism Tax evidence recorded.");
                      },
                      onError: (err) => toast.error(folioErrorMessage(err)),
                    },
                  );
                }}
              >
                Record evidence
              </Button>
            </div>
          ) : null}

          {dto.capability.canAddItem && dto.catalogue.length > 0 ? (
            <div className="rounded-lg border p-3" style={{ borderColor: `${NAVY}1F` }}>
              <p className="text-sm font-semibold" style={{ color: NAVY }}>
                Add an extra
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {dto.catalogue.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      addItem.mutate(
                        {
                          catalogueId: c.id,
                          quantity: 1,
                          clientRequestId: makeRequestId(),
                        },
                        { onError: (err) => toast.error(folioErrorMessage(err)) },
                      )
                    }
                  >
                    {c.displayName} ·{" "}
                    {formatFolioMoney(c.defaultUnitPrice, dto.reservation.currency)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {dto.capability.canAdjust ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setDiscountOpen(true)}>
              Add discount
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={Boolean(reverseTarget)} onOpenChange={(o) => !o && setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this line</DialogTitle>
            <DialogDescription>
              The line stays on the folio and a matching negative line is added. Nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="reverse-reason">Reason</Label>
          <Input
            id="reverse-reason"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                const target = reverseTarget;
                if (!target) return;
                reverse.mutate(
                  {
                    lineId: target.id,
                    reason: reverseReason,
                    clientRequestId: makeRequestId(),
                  },
                  {
                    onSuccess: () => setReverseTarget(null),
                    onError: (err) => toast.error(folioErrorMessage(err)),
                  },
                );
              }}
            >
              Reverse line
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a discount</DialogTitle>
            <DialogDescription>
              Discounts are recorded as their own folio line with a reason and can only be undone by
              a reversal.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="discount-amount">Amount</Label>
          <Input
            id="discount-amount"
            inputMode="decimal"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
          />
          <Label htmlFor="discount-reason">Reason</Label>
          <Input
            id="discount-reason"
            value={discountReason}
            onChange={(e) => setDiscountReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                const value = Number(discountAmount);
                if (!Number.isFinite(value) || value <= 0) {
                  toast.error("Enter a positive discount amount.");
                  return;
                }
                adjust.mutate(
                  {
                    lineType: "discount",
                    description: "Discount",
                    amountCents: -Math.round(value * 100),
                    reason: discountReason,
                    clientRequestId: makeRequestId(),
                  },
                  {
                    onSuccess: () => {
                      setDiscountOpen(false);
                      setDiscountAmount("");
                      setDiscountReason("");
                    },
                    onError: (err) => toast.error(folioErrorMessage(err)),
                  },
                );
              }}
            >
              Add discount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
