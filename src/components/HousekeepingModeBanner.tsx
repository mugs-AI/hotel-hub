// Explains which housekeeping experience this property is running, so a
// staff member never wonders why their colleague's screen looks different.
import { useHousekeepingBoard } from "@/lib/housekeeping-client";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";

export function HousekeepingModeBanner() {
  const board = useHousekeepingBoard();
  const mode = board.data?.mode;
  if (!mode) return null;
  return (
    <p
      className="rounded-md border bg-white px-3 py-2 text-xs"
      style={{ borderColor: `${NAVY}1F`, borderLeft: `4px solid ${TEAL}`, color: NAVY }}
    >
      {mode === "dedicated" ? (
        <>
          <strong>Dedicated housekeeping.</strong> Housekeepers work this board directly; Front Desk
          sees room readiness without having to run the cleaning steps.
        </>
      ) : (
        <>
          <strong>Simple front-desk housekeeping.</strong> The desk turns rooms around itself. The
          Owner can switch to a dedicated housekeeping team in Settings.
        </>
      )}
    </p>
  );
}
