import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { hotelJson } from "@/lib/hotel-settings-client";
import { useSecurityIdentity, useSecurityWriter } from "@/lib/security-cash-client";
type Fact = {
  id: string;
  version: string;
  hotelRoomId: string;
  roomNumber: string;
  inspectionClear: boolean;
};
function InspectionEditor({
  reservationId,
  roomId,
  identity,
  isCurrent,
}: {
  reservationId: string;
  roomId: string;
  identity: string;
  isCurrent: (i: string) => boolean;
}) {
  const url = `/api/hotel/reservations/${reservationId}/security-cash`;
  const q = useQuery({
    queryKey: ["security-cash", identity, "inspection", reservationId, roomId],
    queryFn: ({ signal }) => hotelJson<{ holdings: Fact[] }>(url + "?mode=inspection", { signal }),
    retry: false,
  });
  const w = useSecurityWriter(identity, isCurrent);
  const [evidence, setEvidence] = useState(""),
    [clear, setClear] = useState(false);
  const fact = q.data?.holdings.find((h) => h.hotelRoomId === roomId);
  if (q.isPending) return <p className="text-xs">Loading room inspection record…</p>;
  if (q.isError || !fact)
    return <p className="text-xs">No security inspection record is available for this room.</p>;
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await w.send(url, {
          command: {
            action: "inspect",
            holdingId: fact.id,
            version: fact.version,
            evidence,
            clear,
          },
        });
        if (r) {
          setEvidence("");
          await q.refetch();
        }
      }}
    >
      <p className="text-xs">Departure room / keys check — separate from housekeeping Ready.</p>
      <label className="block text-xs">
        Inspection facts / paper reference
        <input
          required
          maxLength={500}
          className="mt-1 w-full rounded border p-2"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label className="block text-xs">
        <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Room
        and keys clear
      </label>
      <Button size="sm" disabled={w.busy}>
        Record inspection facts
      </Button>
      {w.feedback ? (
        <p role="status" className="text-xs">
          {w.feedback}
        </p>
      ) : null}
    </form>
  );
}
export function SecurityInspectionPanel({
  reservationId,
  roomId,
}: {
  reservationId: string;
  roomId: string;
}) {
  const s = useSecurityIdentity();
  const [open, setOpen] = useState(false);
  if (!s.identity || !s.me.data?.authenticated) return null;
  return (
    <details className="mt-2 rounded border p-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs font-semibold">
        Departure room / key inspection
      </summary>
      {open ? (
        <InspectionEditor
          key={s.identity}
          reservationId={reservationId}
          roomId={roomId}
          identity={s.identity}
          isCurrent={s.isCurrent}
        />
      ) : null}
    </details>
  );
}
