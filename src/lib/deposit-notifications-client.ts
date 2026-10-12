import { toast } from "sonner";
import { createDepositNoticeObserver, type DepositAppliedEvent } from "./deposit-notifications";
import { formatReceiptMoney } from "./receipt-controls";
const observers = new WeakMap<object, ReturnType<typeof createDepositNoticeObserver>>();
export function depositNoticeObserver(client: object) {
  let observer = observers.get(client);
  if (!observer) {
    observer = createDepositNoticeObserver();
    observers.set(client, observer);
  }
  return observer;
}
const activeNotices = new Map<string, string>();
export function dismissForeignDepositNotices(identity: string | null): void {
  for (const [id, scope] of activeNotices)
    if (scope !== identity) {
      toast.dismiss(id);
      activeNotices.delete(id);
    }
}
export function announceDepositRefreshFailure(
  identity: string,
  events: DepositAppliedEvent[],
): void {
  if (!events.length) return;
  const id = `deposit-refresh:${identity}`;
  activeNotices.set(id, identity);
  toast.warning("N3 correction verified. Screen refresh failed.", {
    id,
    position: "bottom-right",
    description: "Reload the reservation before using its balances.",
    duration: 8000,
    onDismiss: () => activeNotices.delete(id),
    onAutoClose: () => activeNotices.delete(id),
  });
}
const soundKey = (identity: string) => `hh:deposit-sound:${identity}`;
export function depositSoundMuted(identity: string): boolean {
  try {
    return localStorage.getItem(soundKey(identity)) === "muted";
  } catch {
    return false;
  }
}
export function setDepositSoundMuted(identity: string, muted: boolean): void {
  try {
    localStorage.setItem(soundKey(identity), muted ? "muted" : "on");
  } catch {
    /* visual feedback remains */
  }
}
let audio: AudioContext | null = null;
/** Call from a browser gesture. A blocked audio device never hides visual success. */
export async function enableDepositSound(): Promise<void> {
  try {
    if (typeof window === "undefined" || !window.AudioContext) return;
    audio ??= new window.AudioContext();
    if (audio.state === "suspended") await audio.resume();
  } catch {
    /* browser audio policy */
  }
}
async function chime(): Promise<void> {
  try {
    if (!audio || audio.state !== "running") return;
    const start = audio.currentTime;
    for (const [offset, frequency] of [
      [0, 660],
      [0.12, 880],
    ]) {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.08, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.18);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.2);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  } catch {
    /* visual success is still shown */
  }
}
export function announceDepositEvents(identity: string, events: DepositAppliedEvent[]): void {
  if (!events.length) return;
  for (const e of events) {
    const id = `deposit:${identity}:${e.requestId}`;
    activeNotices.set(id, identity);
    toast.success("Deposit correction completed. N3 verified.", {
      id,
      onDismiss: () => activeNotices.delete(id),
      onAutoClose: () => activeNotices.delete(id),
      position: "bottom-right",
      duration: 8000,
      description: `${e.bookingReference} · ${e.docCode}: ${formatReceiptMoney(e.beforeCents, e.currency)} → ${formatReceiptMoney(e.afterCents, e.currency)}`,
    });
  }
  if (!depositSoundMuted(identity)) void chime();
}
