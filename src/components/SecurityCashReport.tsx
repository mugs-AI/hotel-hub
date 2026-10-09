import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { hotelJson } from "@/lib/hotel-settings-client";
import { useSecurityIdentity, useSecurityWriter, securityPrint } from "@/lib/security-cash-client";
import {
  securityCsvCell,
  securityMoney,
  securityMessage,
  securityCountHoldings,
  type SecurityOverview,
  type SecurityReport,
  type SecurityStatement,
  type SecurityPolicy,
} from "@/lib/security-cash";
const localNow = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(" ", "T");
const csv = (rows: unknown[][]) =>
  rows.map((row) => row.map(securityCsvCell).join(",")).join("\r\n");
function exportReport(r: SecurityReport) {
  const b = new Blob(
    [
      csv([
        ["As at", r.asAt],
        ["Opening held cents", r.openingCents],
        ["Collections cents", r.collectionsCents],
        ["Returns cents", r.returnsCents],
        ["Transfers cents", r.transfersCents],
        ["Adjustments cents", r.adjustmentsCents],
        ["Closing held cents", r.closingCents],
        [],
        [
          "Receipt",
          "Booking",
          "Room",
          "Payer",
          "Storage",
          "Held cents",
          "Returnable cents",
          "Pending disposition cents",
          "Case",
        ],
        ...r.holdings.map((h) => [
          h.receiptNumber,
          h.bookingReference,
          h.roomNumber,
          h.payer,
          h.storage,
          h.heldCents,
          h.returnableCents,
          h.pendingDispositionCents,
          h.openCase ? "Unresolved" : "",
        ]),
        [],
        ["Movement", "Holding", "At", "Actor", "Held change cents", "Guest due change cents"],
        ...r.events.map((e) => [e.event, e.holdingId, e.at, e.actor, e.deltaHeld, e.deltaDue]),
      ]),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url;
  a.download = "HotelHub-security-cash.csv";
  a.click();
  URL.revokeObjectURL(url);
}
export function SecurityReportView({
  report: r,
  statement,
}: {
  report: SecurityReport;
  statement?: SecurityStatement;
}) {
  return (
    <article className="rounded-lg border bg-white p-4 text-[#102A43]">
      <h2 className="text-xl font-bold">Security Cash Custody Statement</h2>
      <p className="text-xs">
        Period {r.from} · As at {r.asAt} · Malaysia display / UTC evidence
      </p>
      <p className="mt-2 text-sm">
        Guest cash kept separately from sales. Open cases carry forward until actual return or
        disposition.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        {[
          ["Opening held", r.openingCents],
          ["Collections", r.collectionsCents],
          ["Cash / evidenced accountant returns", r.returnsCents],
          ["Actual approved transfers", r.transfersCents],
          ["Owner corrections", r.adjustmentsCents],
          ["Closing held", r.closingCents],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd className="font-semibold">{securityMoney(Number(value))}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {[
                "Receipt / booking",
                "Room / envelope",
                "Payer",
                "Held",
                "Returnable",
                "Pending disposition",
                "Case",
                ...(statement ? ["Actual envelope count", "Envelope variance"] : []),
              ].map((s) => (
                <th key={s} className="border-b p-2">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.holdings.map((h) => (
              <tr key={h.id}>
                <td className="border-b p-2">
                  {h.receiptNumber}
                  <br />
                  {h.bookingReference}
                </td>
                <td className="border-b p-2">
                  {h.roomNumber} / {h.storage}
                </td>
                <td className="border-b p-2">{h.payer}</td>
                <td className="border-b p-2">{securityMoney(h.heldCents)}</td>
                <td className="border-b p-2">{securityMoney(h.returnableCents)}</td>
                <td className="border-b p-2">{securityMoney(h.pendingDispositionCents)}</td>
                <td className="border-b p-2">
                  {h.openCase ? "Unresolved" : h.pendingReturn ? "Pending handover" : ""}
                </td>
                {statement
                  ? (() => {
                      const count = statement.counts.find((c) => c.holdingId === h.id);
                      return (
                        <>
                          <td className="border-b p-2">
                            {count ? securityMoney(count.cents) : "Outside count scope"}
                          </td>
                          <td className="border-b p-2">
                            {count ? securityMoney(count.cents - h.heldCents) : "—"}
                          </td>
                        </>
                      );
                    })()
                  : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.events.length ? (
        <div className="mt-4 text-xs">
          <h3 className="font-bold">Recorded movements and exceptions</h3>
          {r.events.map((e) => (
            <p key={e.id} className="border-b py-1">
              {e.at} · {e.event} · {e.actor} · {securityMoney(e.deltaHeld)} cash change ·{" "}
              {String(e.detail.reason || e.detail.evidence || "")}
            </p>
          ))}
        </div>
      ) : null}
      {statement ? (
        <div className="mt-4 rounded border p-3 text-sm">
          <p>Statement {statement.id}</p>
          <p>
            Counted {securityMoney(statement.countedCents)} · Variance{" "}
            {securityMoney(statement.varianceCents)}
          </p>
          <p>
            Storage {statement.storage} · {statement.status.replaceAll("_", " ")}
          </p>
          <p>
            First signer {statement.firstSigner} · Second signer{" "}
            {statement.secondSigner || "Not yet signed"}
          </p>
          <p>{statement.singlePerson ? "Single-person count — Owner review required" : ""}</p>
          <p>{statement.note}</p>
          <p>A variance remains an exception; this statement does not change cash balances.</p>
        </div>
      ) : null}
    </article>
  );
}
function PolicyEditor({
  policy: p,
  busy,
  onSave,
}: {
  policy: SecurityPolicy;
  busy: boolean;
  onSave: (p: SecurityPolicy) => void;
}) {
  const [amount, setAmount] = useState((p.amountCents / 100).toFixed(2));
  const [required, setRequired] = useState(p.required);
  const [terms, setTerms] = useState(p.terms);
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...p, amountCents: Math.round(Number(amount) * 100), required, terms });
      }}
    >
      <h3 className="font-bold">Security cash policy</h3>
      <label className="block text-sm">
        RM per room per stay
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          className="mt-1 block w-full rounded border p-2"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />{" "}
        Required before check-in when security collections are enabled
      </label>
      <label className="block text-sm">
        Disclosed terms
        <textarea
          className="mt-1 block w-full rounded border p-2"
          required
          maxLength={1500}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
      </label>
      <p className="text-xs">
        Cash notes only. No automatic use towards bills. Existing receipts keep their saved terms.
      </p>
      <Button disabled={busy}>Save security policy</Button>
    </form>
  );
}
function ReportEditor({
  identity,
  isCurrent,
  shift,
  includePolicy,
}: {
  identity: string;
  isCurrent: (i: string) => boolean;
  shift: boolean;
  includePolicy: boolean;
}) {
  const [from, setFrom] = useState(localNow().slice(0, 7) + "-01T00:00");
  const [to, setTo] = useState(localNow());
  const [range, setRange] = useState({
    from: new Date(localNow().slice(0, 7) + "-01T00:00:00+08:00").toISOString(),
    asAt: new Date().toISOString(),
  });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [single, setSingle] = useState(false);
  const [note, setNote] = useState("");
  const [storage, setStorage] = useState("");
  const [ack, setAck] = useState("");
  const [signedCheck, setSignedCheck] = useState(false);
  const [print, setPrint] = useState<{
    report: SecurityReport;
    statement?: SecurityStatement;
  } | null>(null);
  const printId = useId();
  const q = useQuery({
    queryKey: ["security-cash", identity, "overview", shift, range.from, range.asAt],
    queryFn: ({ signal }) =>
      hotelJson<SecurityOverview>(
        `/api/hotel/security-cash?mode=${shift ? "shift" : "owner"}&from=${encodeURIComponent(range.from)}&asAt=${encodeURIComponent(range.asAt)}`,
        { signal },
      ),
    retry: false,
  });
  const w = useSecurityWriter(identity, isCurrent);
  async function record(payload: Record<string, unknown>) {
    const result = await w.send<unknown>("/api/hotel/security-cash", payload);
    if (!result) return;
    setRange({ ...range, asAt: new Date().toISOString() });
    setCounts({});
    setSignedCheck(false);
    await q.refetch();
  }
  if (q.isPending) return <p className="text-sm">Loading custody statements…</p>;
  if (q.isError || !q.data)
    return (
      <p className="text-sm text-amber-800">
        {securityMessage(q.error instanceof Error ? q.error.message : "")}
      </p>
    );
  const r = q.data.report;
  const currentHoldings = securityCountHoldings(r.holdings);
  return (
    <div className="mt-4 space-y-4">
      {includePolicy ? (
        <PolicyEditor
          key={q.data.policy.version}
          policy={q.data.policy}
          busy={w.busy}
          onSave={(policy) => void record({ policy })}
        />
      ) : null}
      {!shift ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setRange({
              from: new Date(from + ":00+08:00").toISOString(),
              asAt: new Date(to + ":00+08:00").toISOString(),
            });
          }}
        >
          <label className="text-sm">
            From (Malaysia)
            <input
              className="block rounded border p-2"
              type="datetime-local"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            As at (Malaysia)
            <input
              className="block rounded border p-2"
              type="datetime-local"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button variant="outline">View as-at report</Button>
        </form>
      ) : null}
      <SecurityReportView report={r} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setRange({ ...range, asAt: new Date().toISOString() });
            setTo(localNow());
          }}
        >
          Reload current cash
        </Button>
        <Button variant="outline" onClick={() => setPrint({ report: r })}>
          Prepare report print
        </Button>
        {!shift ? (
          <Button variant="outline" onClick={() => exportReport(r)}>
            Export CSV
          </Button>
        ) : null}
      </div>
      <form
        className="space-y-3 rounded-lg border border-amber-200 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void record({
            statement: {
              action: "count",
              from: range.from,
              counts: currentHoldings.map((h) => ({
                holdingId: h.id,
                cents: Math.round(Number(counts[h.id]) * 100),
              })),
              singlePerson: single,
              note,
              storage,
            },
          });
        }}
      >
        <h3 className="font-bold">Count actual cash in each envelope</h3>
        <p className="text-xs">
          Do not type a balancing amount. A shortage or surplus is preserved for Owner review.
          Creating a count statement never changes money.
        </p>
        {currentHoldings.map((h) => (
          <label key={h.id} className="block text-sm">
            {h.receiptNumber} · Room {h.roomNumber} · {h.storage} · Expected{" "}
            {securityMoney(h.heldCents)}
            <input
              type="number"
              min="0"
              step="0.01"
              required
              className="mt-1 block w-full rounded border p-2"
              aria-label={`Actual count ${h.receiptNumber}`}
              value={counts[h.id] ?? ""}
              onChange={(e) => setCounts({ ...counts, [h.id]: e.target.value })}
            />
          </label>
        ))}
        <label className="block text-sm">
          Locked storage / handover location
          <input
            required
            maxLength={500}
            className="mt-1 block w-full rounded border p-2"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Count note
          <input
            maxLength={500}
            className="mt-1 block w-full rounded border p-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} />{" "}
          Single-person shift (Owner review required)
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            required
            checked={signedCheck}
            onChange={(e) => setSignedCheck(e.target.checked)}
          />{" "}
          I counted these notes and sign this immutable statement.
        </label>
        <Button disabled={w.busy || !signedCheck}>Record signed count</Button>
      </form>
      <h3 className="font-semibold">Latest 50 saved statements</h3>
      <p className="text-xs">
        Earlier money and unresolved cases remain in the as-at report. Saved statements retain their
        original count and snapshot.
      </p>
      <label className="block text-sm">
        Second signer / Owner review acknowledgment
        <input
          maxLength={500}
          className="mt-1 block w-full rounded border p-2"
          value={ack}
          onChange={(e) => setAck(e.target.value)}
        />
      </label>
      {q.data.statements.map((s) => (
        <div key={s.id} className="rounded border p-3 text-sm">
          <p>
            {s.snapshot.asAt} · {s.status.replaceAll("_", " ")} · Variance{" "}
            {securityMoney(s.varianceCents)}
          </p>
          <p>
            First {s.firstSigner} · Second {s.secondSigner || "Pending"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setPrint({ report: s.snapshot, statement: s })}
            >
              Prepare saved statement print
            </Button>
            {!s.secondSigner ? (
              <Button
                disabled={w.busy || !ack.trim()}
                onClick={() =>
                  void record({
                    statement: {
                      action: "sign",
                      statementId: s.id,
                      version: s.version,
                      acknowledgment: ack,
                    },
                  })
                }
              >
                Sign / Owner review
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {w.feedback ? (
        <p role="status" className="text-sm">
          {w.feedback}
        </p>
      ) : null}
      {print ? (
        <div className="space-y-3">
          <div id={printId}>
            <SecurityReportView {...print} />
          </div>
          <Button onClick={() => securityPrint(printId)}>Print / save PDF</Button>
          <Button variant="outline" onClick={() => setPrint(null)}>
            Close print view
          </Button>
        </div>
      ) : null}
      <style>
        {
          "@media print { body * { visibility:hidden; } [data-security-print-active], [data-security-print-active] * { visibility:visible; } [data-security-print-active] { position:absolute; inset:0; background:white; padding:20px; } }"
        }
      </style>
    </div>
  );
}
export function SecurityCashReport({
  shift = false,
  includePolicy = false,
}: {
  shift?: boolean;
  includePolicy?: boolean;
}) {
  const s = useSecurityIdentity();
  if (
    !s.identity ||
    !s.me.data?.authenticated ||
    (!shift && s.me.data.role !== "owner") ||
    !["owner", "front_desk"].includes(s.me.data.role || "")
  )
    return null;
  return (
    <ReportEditor
      key={s.identity}
      identity={s.identity}
      isCurrent={s.isCurrent}
      shift={shift}
      includePolicy={includePolicy && s.me.data.role === "owner"}
    />
  );
}
