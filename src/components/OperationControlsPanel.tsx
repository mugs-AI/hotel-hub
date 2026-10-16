import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CardHeading } from "./CardInfoPopover";
import { useOperationControls, saveOperationControls } from "@/lib/operation-controls-client";
export function OperationControlsPanel() {
  const query = useOperationControls(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<boolean | null>(null),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  const controls = query.isSuccess ? query.data : undefined;
  const enabled = draft ?? controls?.rateChangeEnabled ?? true;
  async function save() {
    if (!controls?.available || controls.revision === null || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await saveOperationControls({
        rateChangeEnabled: enabled,
        expectedRevision: controls.revision,
      });
      await qc.invalidateQueries({ queryKey: ["operation-controls"] });
      setDraft(null);
      setMessage("Change rate setting saved.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "operation_controls_stale"
          ? "This setting changed on another device. Refresh and review it before saving."
          : "The setting could not be saved. Refresh and try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="rounded-lg border border-border bg-white p-5 shadow-sm">
      <CardHeading title="Change rate">
        Enable this action for reservations. Owner and Front Desk still follow the reservation
        exception approval policy. Turning it off preserves saved rates and history.
      </CardHeading>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving || !controls?.available}
          onChange={(event) => setDraft(event.target.checked)}
        />
        Enable Change rate
      </label>
      {!controls?.available ? (
        <p role="status" className="mt-2 text-sm text-amber-900">
          {query.isPending ? "Loading setting…" : "This control is not available yet."}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-3 rounded-md bg-[#102A43] px-3 py-2 text-sm text-white disabled:opacity-50"
        disabled={saving || !controls?.available || enabled === controls.rateChangeEnabled}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save rate control"}
      </button>
      {message ? (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
