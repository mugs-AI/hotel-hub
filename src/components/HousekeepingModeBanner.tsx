// Explains which housekeeping experience this property is running, so a
// staff member never wonders why their colleague's screen looks different.
// Same engine and same lifecycle in both modes — only the framing differs.
import { useHousekeepingBoard } from "@/lib/housekeeping-client";
import { useSessionMe } from "@/lib/session-client";
import { HK_COLORS, MODE_PRESENTATION, ROLE_HINTS } from "@/lib/housekeeping";

export function HousekeepingModeBanner() {
  const board = useHousekeepingBoard();
  const session = useSessionMe();
  const mode = board.data?.mode;
  if (!mode) return null;
  const presentation = MODE_PRESENTATION[mode];
  const role = session.data?.authenticated ? session.data.role : null;
  const roleHint = role ? ROLE_HINTS[role] : null;

  return (
    <section
      className="rounded-md border bg-white px-3 py-2.5"
      style={{
        borderColor: `${presentation.accent}55`,
        borderLeft: `5px solid ${presentation.accent}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: HK_COLORS.navy }}>
          {presentation.title}
        </h2>
        {mode === "dedicated" && roleHint && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: HK_COLORS.indigoSoft, color: HK_COLORS.indigoInk }}
          >
            {roleHint}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs" style={{ color: HK_COLORS.gray }}>
        {presentation.summary}{" "}
        {mode === "dedicated"
          ? "Use the floor filters and per-room History to manage the team's work."
          : "The Owner can switch to a dedicated housekeeping team in Settings \u2192 System."}
      </p>
    </section>
  );
}
