import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { hotelJson } from "@/lib/hotel-settings-client";
import { useSecurityIdentity, useSecurityWriter, securityPrint } from "@/lib/security-cash-client";
import {
  securityMoney,
  securityMessage,
  type SecurityBooking,
  type SecurityHolding,
} from "@/lib/security-cash";
import { SecurityCashReport } from "./SecurityCashReport";
type Room = { id: string; roomNumber: string; allocationStatus?: string };
type Action = (action: string, h?: SecurityHolding, roomStayId?: string) => void;
export function SecurityReceipt({
  holding: h,
  property,
  copy = true,
}: {
  holding: SecurityHolding;
  property?: SecurityBooking["property"];
  copy?: boolean;
}) {
  return (
    <article className="security-print rounded-xl border border-amber-200 bg-white p-6 text-[#102A43]">
      <p className="text-lg font-bold">{property?.name || "Hotel"}</p>
      <p className="text-xs">
        {property?.address} {property?.phone} {property?.email}
      </p>
      <h2 className="mt-5 text-xl font-bold">Security Deposit Receipt {copy ? "· Copy" : ""}</h2>
      <p className="mt-2 text-sm text-amber-900">
        Refundable security deposit — held separately from room payment
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
        <dt>Receipt</dt>
        <dd>{h.receiptNumber}</dd>
        <dt>Booking / room</dt>
        <dd>
          {h.bookingReference} / {h.roomNumber}
        </dd>
        <dt>Payer</dt>
        <dd>{h.payer}</dd>
        <dt>Authorized recipient</dt>
        <dd>{h.recipient}</dd>
        <dt>Cash collected</dt>
        <dd className="font-bold">{securityMoney(h.originalCents)}</dd>
        <dt>Recorded (Malaysia)</dt>
        <dd>
          {new Date(h.collectedAt || h.createdAt).toLocaleString("en-GB", {
            timeZone: "Asia/Kuala_Lumpur",
          })}
        </dd>
        <dt>Staff</dt>
        <dd>{h.collectedBy || h.createdBy}</dd>
      </dl>
      <p className="mt-5 text-sm">{h.terms}</p>
      <p className="mt-5 text-xs">Guest / staff acknowledgment: ____________________</p>
    </article>
  );
}
export function SecurityCashLedger({
  state,
  rooms,
  owner,
  onAction,
  busy,
}: {
  state: SecurityBooking;
  rooms: Room[];
  owner: boolean;
  onAction: Action;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-amber-50 p-3 text-sm">
        <div>
          Physical cash held
          <strong className="block text-lg">
            {securityMoney(state.holdings.reduce((n, h) => n + h.heldCents, 0))}
          </strong>
        </div>
        <div>
          Guest returnable
          <strong className="block text-lg">
            {securityMoney(state.holdings.reduce((n, h) => n + h.returnableCents, 0))}
          </strong>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Cash notes kept in labelled envelopes, separate from sales. Security cash does not reduce
        the guest’s bill.
      </p>
      {rooms
        .filter(
          (r) =>
            r.allocationStatus !== "released" &&
            !state.holdings.some((h) => h.roomStayId === r.id && !h.waived),
        )
        .map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Room {r.roomNumber} · {securityMoney(state.policy.amountCents)}
            </span>
            {state.enabled ? (
              <Button disabled={busy} onClick={() => onAction("collect", undefined, r.id)}>
                Collect security cash
              </Button>
            ) : (
              <span className="text-xs">New collections are off</span>
            )}
            {owner && !state.holdings.some((h) => h.roomStayId === r.id) ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAction("waive", undefined, r.id)}
              >
                Owner waiver
              </Button>
            ) : null}
          </div>
        ))}
      {state.holdings.map((h) => (
        <section key={h.id} className="rounded-lg border border-amber-200 p-3">
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="text-sm font-bold">
              {h.receiptNumber} · Room {h.roomNumber}
            </h3>
            <span className="text-xs">
              {h.waived
                ? "Owner waiver"
                : h.openCase
                  ? "Unresolved custody case"
                  : h.heldCents === 0
                    ? "Cash disposed / returned"
                    : "Cash held"}
            </span>
          </div>
          <p className="mt-2 text-sm">
            Held {securityMoney(h.heldCents)} · Returnable {securityMoney(h.returnableCents)} ·
            Pending disposition {securityMoney(h.pendingDispositionCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {h.payer} → {h.recipient} · {h.storage}
          </p>
          {h.pendingReturn ? (
            <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
              <p className="font-semibold text-sm">
                Pending cash handover · {securityMoney(h.pendingReturn.cents)} cash
              </p>
              <p className="text-xs">
                Reserved by {h.pendingReturn.reservedBy}. Verify the actual cash and signed
                acknowledgment before confirming. Do not pay again after an interruption.
              </p>
              {!h.inspectionClear ? (
                <p className="text-sm text-amber-900">
                  Room inspection changed during this handover. The Owner must reconcile the room,
                  cash and signed paper, or release an unperformed return.
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  disabled={busy || (!h.inspectionClear && !owner)}
                  onClick={() => onAction("confirm_return", h)}
                >
                  Confirm cash handed
                </Button>
                {owner ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => onAction("release_return", h)}
                  >
                    Owner: release unperformed return
                  </Button>
                ) : null}
              </div>
            </div>
          ) : h.returnableCents > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => onAction("inspect", h)}>
                Record room / key inspection
              </Button>
              <Button
                disabled={busy || !h.inspectionClear}
                onClick={() => onAction("reserve_return", h)}
              >
                Reserve return {securityMoney(h.returnableCents)} cash
              </Button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!h.waived ? (
              <Button variant="outline" onClick={() => onAction("print", h)}>
                Print receipt Copy
              </Button>
            ) : null}
            {owner && !h.pendingReturn ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => onAction("owner", h)}>
                  Owner custody actions
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
const ownerActions = [
  ["deduct", "Approve itemized deduction"],
  ["restore_due", "Restore deducted amount for guest return"],
  ["adjust", "Record actual count correction"],
  ["transfer", "Record approved cash moved to hotel drawer"],
  ["storage", "Move within security storage"],
  ["authorize_recipient", "Lost receipt / recipient authority exception"],
  ["inspection_waiver", "Waive inspection with evidence"],
  ["open_case", "Guest left / disputed amount / noncash exception"],
  ["resolve_case", "Resolve case after cash disposition"],
  ["bank_return_record", "Record accountant bank-return exception with cash disposition"],
];
function CashActionForm({
  action: initial,
  h,
  roomStayId,
  state,
  owner,
  onSubmit,
  busy,
  onClose,
}: {
  action: string;
  h?: SecurityHolding;
  roomStayId?: string;
  state: SecurityBooking;
  owner: boolean;
  onSubmit: (b: Record<string, unknown>) => void;
  busy: boolean;
  onClose: () => void;
}) {
  const [action, setAction] = useState(initial === "owner" ? "open_case" : initial);
  const [values, setValues] = useState<Record<string, string>>({
    recipient: h?.recipient || "",
    kind: "guest_left",
  });
  const [flag, setFlag] = useState(false);
  const [checked, setChecked] = useState(false);
  const input = (key: string, label: string, required = true, readOnly = false) => (
    <label className="block text-sm" key={key}>
      {label}
      <input
        className="mt-1 block w-full rounded border p-2"
        name={key}
        value={values[key] || ""}
        required={required}
        readOnly={readOnly}
        maxLength={500}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </label>
  );
  const amountInput = (key: string, label: string) => (
    <label className="block text-sm" key={key}>
      {label}
      <input
        type="number"
        step="0.01"
        className="mt-1 block w-full rounded border p-2"
        required
        value={values[key] || ""}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </label>
  );
  const reason = [
    "waive",
    "release_return",
    "deduct",
    "restore_due",
    "adjust",
    "transfer",
    "storage",
    "authorize_recipient",
    "inspection_waiver",
    "open_case",
    "resolve_case",
    "bank_return_record",
  ].includes(action);
  const evidence = reason && action !== "waive" && action !== "release_return";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const b: Record<string, unknown> = {
      action,
      ...(h ? { holdingId: h.id, version: h.version } : { roomStayId }),
    };
    if (action === "collect")
      Object.assign(b, {
        payer: values.payer,
        recipient: values.recipient,
        storage: values.storage,
        method: "cash",
        policyVersion: state.policy.version,
      });
    if (reason) b.reason = values.reason;
    if (evidence) b.evidence = values.evidence;
    if (["reserve_return", "confirm_return", "authorize_recipient"].includes(action))
      b.recipient = action === "authorize_recipient" ? values.recipient : h?.recipient;
    if (action === "inspect") Object.assign(b, { clear: flag, evidence: values.evidence });
    if (["confirm_return", "release_return"].includes(action)) b.operationId = h?.pendingReturn?.id;
    if (action === "confirm_return")
      Object.assign(b, {
        acknowledgment: values.acknowledgment,
        ...(owner && values.reason ? { reason: values.reason } : {}),
      });
    if (["deduct", "restore_due", "adjust", "transfer"].includes(action))
      b.cents = Math.round(Number(values.cents) * 100);
    if (action === "adjust") b.actualCountCents = Math.round(Number(values.actualCountCents) * 100);
    if (action === "deduct")
      Object.assign(b, { disputed: flag, acknowledgment: values.acknowledgment || "" });
    if (["transfer", "bank_return_record"].includes(action))
      b.accountantReference = values.accountantReference;
    if (action === "bank_return_record") {
      b.acknowledgment = values.acknowledgment;
      b.cashDispositionEvidence = values.cashDispositionEvidence;
    }
    if (action === "restore_due") b.acknowledgment = values.acknowledgment;
    if (action === "transfer" && values.acknowledgment) b.acknowledgment = values.acknowledgment;
    if (action === "storage") b.storage = values.storage;
    if (action === "open_case") b.kind = values.kind;
    onSubmit(b);
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-white p-4">
      <h3 className="font-bold">{h?.receiptNumber || "New security record"}</h3>
      {initial === "owner" ? (
        <label className="block text-sm">
          Owner action
          <select
            className="mt-1 w-full rounded border p-2"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setValues({ recipient: h?.recipient || "", kind: "guest_left" });
              setFlag(false);
              setChecked(false);
            }}
          >
            {ownerActions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {action === "collect" ? (
        <>
          <p className="font-semibold">
            Collect {securityMoney(state.policy.amountCents)} · Malaysian cash notes only
          </p>
          <p className="text-sm">{state.policy.terms}</p>
          {input("payer", "Actual payer")}
          {input("recipient", "Authorized return recipient")}
          {input("storage", "Envelope / locked storage reference")}
        </>
      ) : null}
      {["reserve_return", "confirm_return"].includes(action) ? (
        <>
          <p className="font-semibold">
            {securityMoney(h?.pendingReturn?.cents ?? h?.returnableCents ?? 0)} · Cash only
          </p>
          {input("recipient", "Verify authorized recipient", true, true)}
        </>
      ) : null}
      {reason ? input("reason", "Reason / itemized deduction details") : null}
      {evidence ? input("evidence", "Supporting paper / evidence reference (no ID images)") : null}
      {action === "inspect" ? (
        <>
          {input("evidence", "Room and keys inspection facts")}
          <label className="block text-sm">
            <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />{" "}
            Room / keys clear for return
          </label>
        </>
      ) : null}
      {["deduct", "restore_due", "adjust", "transfer"].includes(action)
        ? amountInput("cents", action === "adjust" ? "Adjustment RM (+ / −)" : "Amount RM")
        : null}
      {action === "adjust" ? amountInput("actualCountCents", "Actual cash counted RM") : null}
      {action === "deduct" ? (
        <>
          <label className="text-sm">
            <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />{" "}
            Guest disputes this deduction
          </label>
          {input("acknowledgment", "Guest acknowledgment reference", !flag)}
        </>
      ) : null}
      {["confirm_return", "restore_due", "bank_return_record"].includes(action)
        ? input("acknowledgment", "Signed recipient acknowledgment / accountant return proof")
        : null}
      {action === "confirm_return" && owner
        ? input(
            "reason",
            "Owner reconciliation: room inspection, actual cash and paper checked",
            !h?.inspectionClear,
          )
        : null}
      {["transfer", "bank_return_record"].includes(action)
        ? input("accountantReference", "Accountant charge / movement document reference")
        : null}
      {action === "transfer" && h?.openCase
        ? input("acknowledgment", "Guest acknowledgment / dispute settlement approval")
        : null}
      {action === "bank_return_record"
        ? input(
            "cashDispositionEvidence",
            "Actual notes transferred out: signed cash disposition reference",
          )
        : null}
      {action === "bank_return_record" ? (
        <p className="text-sm text-amber-900">
          Record only an already completed accountant return AND actual security notes transferred
          out. Evidence must identify both. This screen sends no bank or N3 refund.
        </p>
      ) : null}
      {action === "storage" ? input("storage", "New locked storage location") : null}
      {action === "authorize_recipient"
        ? input("recipient", "Verified authorized recipient")
        : null}
      {action === "open_case" ? input("kind", "Exception category") : null}
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          required
        />{" "}
        I verified the cash, recipient authority and supporting paper for this action.
      </label>
      <div className="flex gap-2">
        <Button disabled={busy || !checked}>{busy ? "Recording…" : "Record custody action"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
function CashEditor({
  identity,
  isCurrent,
  reservationId,
  rooms,
  owner,
}: {
  identity: string;
  isCurrent: (v: string) => boolean;
  reservationId: string;
  rooms: Room[];
  owner: boolean;
}) {
  const printId = useId();
  const url = `/api/hotel/reservations/${reservationId}/security-cash`;
  const q = useQuery({
    queryKey: ["security-cash", identity, "booking", reservationId],
    queryFn: ({ signal }) => hotelJson<SecurityBooking>(url, { signal }),
    retry: false,
  });
  const w = useSecurityWriter(identity, isCurrent);
  const [selected, setSelected] = useState<{
    action: string;
    h?: SecurityHolding;
    roomStayId?: string;
  } | null>(null);
  const [printed, setPrinted] = useState<SecurityHolding | null>(null);
  async function submit(command: Record<string, unknown>) {
    const result = await w.send<SecurityHolding>(url, { command });
    if (!result) return;
    setSelected(null);
    if (command.action === "collect") setPrinted(result);
    await q.refetch();
  }
  if (q.isPending) return <p>Loading security cash…</p>;
  if (q.isError || !q.data)
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-800">
          {securityMessage(q.error instanceof Error ? q.error.message : "")}
        </p>
        <Button variant="outline" onClick={() => void q.refetch()}>
          Reload security records
        </Button>
      </div>
    );
  return (
    <>
      <SecurityCashLedger
        state={q.data}
        owner={owner}
        rooms={rooms}
        busy={w.busy}
        onAction={(action, h, roomStayId) =>
          action === "print" ? setPrinted(h || null) : setSelected({ action, h, roomStayId })
        }
      />
      {selected ? (
        <CashActionForm
          key={`${selected.action}:${selected.h?.id}:${selected.h?.version}:${selected.roomStayId}:${q.data.policy.version}`}
          {...selected}
          state={q.data}
          owner={owner}
          busy={w.busy}
          onClose={() => setSelected(null)}
          onSubmit={(b) => void submit(b)}
        />
      ) : null}
      {w.feedback ? (
        <p role="status" className="mt-3 text-sm">
          {w.feedback} Reload before repeating an interrupted action.
        </p>
      ) : null}
      {printed ? (
        <div className="mt-4 space-y-3">
          <div id={printId}>
            <SecurityReceipt holding={printed} property={q.data.property} />
          </div>
          <Button onClick={() => securityPrint(printId)}>Print / save PDF</Button>
          <Button variant="outline" onClick={() => setPrinted(null)}>
            Close receipt
          </Button>
        </div>
      ) : null}
      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-semibold">
          Security cash shift count / statements
        </summary>
        <SecurityCashReport shift />
      </details>
    </>
  );
}
export function SecurityCashCard({
  reservationId,
  rooms = [],
  owner = false,
}: {
  reservationId: string;
  rooms?: Room[];
  owner?: boolean;
}) {
  const scope = useSecurityIdentity();
  if (
    !scope.identity ||
    !scope.me.data?.authenticated ||
    !["owner", "front_desk"].includes(scope.me.data.role || "")
  )
    return null;
  return (
    <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-[#102A43]">Refundable Security Deposit</h2>
      <CashEditor
        key={`${scope.identity}:${reservationId}`}
        identity={scope.identity}
        isCurrent={scope.isCurrent}
        reservationId={reservationId}
        rooms={rooms}
        owner={owner && scope.me.data.role === "owner"}
      />
      <SecurityPrintStyle />
    </section>
  );
}
export function SecurityPrintStyle() {
  return (
    <style>
      {
        "@media print { body * { visibility: hidden; } [data-security-print-active], [data-security-print-active] * { visibility: visible; } [data-security-print-active] { position:absolute; inset:0; border:0; padding:20px; background:white; } .security-print button { display:none; } }"
      }
    </style>
  );
}
