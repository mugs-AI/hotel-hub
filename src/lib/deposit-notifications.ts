export type DepositAppliedEvent = {
  revision: string;
  requestId: string;
  bookingReference: string;
  docCode: string;
  currency: string;
  beforeCents: number;
  afterCents: number;
};
export type DepositNoticePacket = { cursor: string; events: DepositAppliedEvent[] };
const cursor = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
function validEvent(e: DepositAppliedEvent): boolean {
  return (
    !!e &&
    cursor(e.revision) &&
    text(e.requestId, 128) &&
    text(e.bookingReference, 80) &&
    text(e.docCode, 256) &&
    typeof e.currency === "string" &&
    /^[A-Z]{3}$/.test(e.currency) &&
    Number.isSafeInteger(e.beforeCents) &&
    e.beforeCents > 0 &&
    Number.isSafeInteger(e.afterCents) &&
    e.afterCents > 0
  );
}
export function createDepositNoticeObserver() {
  let state: { identity: string; cursor: string } | null = null;
  return {
    cursor(identity: string | null): string | null {
      return state?.identity === identity ? state.cursor : null;
    },
    observe(identity: string | null, packet: DepositNoticePacket | null): DepositAppliedEvent[] {
      if (!identity) {
        state = null;
        return [];
      }
      if (state && state.identity !== identity) state = null;
      if (
        !packet ||
        !cursor(packet.cursor) ||
        !Array.isArray(packet.events) ||
        packet.events.length > 100 ||
        packet.events.some((e) => !validEvent(e) || BigInt(e.revision) > BigInt(packet.cursor))
      )
        return [];
      if (!state) {
        state = { identity, cursor: packet.cursor };
        return [];
      }
      if (BigInt(packet.cursor) <= BigInt(state.cursor)) return [];
      const seen = new Set<string>();
      const events = packet.events
        .filter((e) => BigInt(e.revision) > BigInt(state!.cursor))
        .map((e) => ({
          revision: e.revision,
          requestId: e.requestId,
          bookingReference: e.bookingReference,
          docCode: e.docCode,
          currency: e.currency,
          beforeCents: e.beforeCents,
          afterCents: e.afterCents,
        }));
      for (const e of events) {
        if (seen.has(e.requestId)) return [];
        seen.add(e.requestId);
      }
      state = { identity, cursor: packet.cursor };
      return events;
    },
  };
}
