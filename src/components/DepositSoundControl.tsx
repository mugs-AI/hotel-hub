import { useEffect, useState } from "react";
import { useReceiptIdentity } from "@/lib/receipt-controls-client";
import {
  depositSoundMuted,
  setDepositSoundMuted,
  enableDepositSound,
} from "@/lib/deposit-notifications-client";
export function DepositSoundControl() {
  const identity = useReceiptIdentity();
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    if (identity) setMuted(depositSoundMuted(identity));
    const unlock = () => {
      if (identity && !depositSoundMuted(identity)) void enableDepositSound();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [identity]);
  if (!identity || (!identity.endsWith(":owner") && !identity.endsWith(":front_desk"))) return null;
  return (
    <button
      type="button"
      aria-pressed={!muted}
      title={muted ? "Enable deposit notification sound" : "Mute deposit notification sound"}
      aria-label={muted ? "Enable deposit notification sound" : "Mute deposit notification sound"}
      className="rounded-md border px-2 py-1 text-xs"
      onClick={() => {
        const next = !muted;
        setMuted(next);
        setDepositSoundMuted(identity, next);
        if (!next) void enableDepositSound();
      }}
    >
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
