import type { PaymentAccountChoice } from "@/lib/deposits-client";

export function PaymentMethodRow({
  account,
  label,
  show,
  saving,
  disabled,
  onLabelChange,
  onShowChange,
  onSave,
}: {
  account: PaymentAccountChoice;
  label: string;
  show: boolean;
  saving: boolean;
  disabled: boolean;
  onLabelChange: (label: string) => void;
  onShowChange: (show: boolean) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs">
        <span className="block font-mono">
          {account.code} — {account.name}
        </span>
        <input
          className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm disabled:opacity-60"
          maxLength={40}
          placeholder={account.name}
          value={label}
          disabled={disabled}
          onChange={(e) => onLabelChange(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 py-2 text-sm">
        <input
          type="checkbox"
          checked={show}
          disabled={disabled}
          aria-label={`Show ${account.code} — ${account.name}`}
          onChange={(e) => onShowChange(e.target.checked)}
        />
        Show
      </label>
      <button
        type="button"
        className="rounded-md border px-3 py-2 text-xs disabled:opacity-60"
        disabled={disabled}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save method"}
      </button>
    </div>
  );
}
