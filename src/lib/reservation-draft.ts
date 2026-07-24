// Session-scoped New Reservation draft recovery.
//
// - Versioned sessionStorage record scoped by (tenantId, n3UserKey).
// - NEVER persists raw identity numbers. `guests[].identityNumber` is
//   always stripped before write and never restored.
// - NEVER persists N3 tokens, tenant secrets, role, or session data —
//   only the transient form fields the user has typed.
// - Debounced writes: callers use `scheduleSave()` so keystrokes don't
//   thrash storage.
//
// The module is browser-safe. SSR guards check for `sessionStorage`
// before every access.
import type { GuestDraft, RoomDraft } from "@/lib/reservations-ui";

export const DRAFT_VERSION = 1;
export const DRAFT_KEY_PREFIX = "hotelhub:new-reservation-draft:v1";

export type DraftStep = 1 | 2 | 3 | 4;

export type ReservationDraftV1 = {
  version: 1;
  tenantId: string;
  n3UserKey: string;
  savedAt: string; // ISO
  step: DraftStep;
  arrival: string;
  departure: string;
  bookingSource: string;
  externalRef: string;
  notes: string;
  rooms: RoomDraft[];
  // guests without identityNumber; identityType is preserved
  guests: Array<Omit<GuestDraft, "identityNumber"> & { identityNumber: "" }>;
};

export function draftKey(tenantId: string, n3UserKey: string): string {
  return `${DRAFT_KEY_PREFIX}:${tenantId}:${n3UserKey}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Strip the raw identity number from every guest before persistence. */
export function stripIdentityNumbers(
  guests: readonly GuestDraft[],
): ReservationDraftV1["guests"] {
  return guests.map((g) => ({ ...g, identityNumber: "" }));
}

export type DraftInput = Omit<ReservationDraftV1, "version" | "savedAt">;

export function serializeDraft(input: DraftInput): ReservationDraftV1 {
  return {
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    ...input,
    guests: stripIdentityNumbers(input.guests as unknown as GuestDraft[]),
  };
}

export function saveDraft(input: DraftInput): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    const record = serializeDraft(input);
    s.setItem(draftKey(input.tenantId, input.n3UserKey), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(
  tenantId: string,
  n3UserKey: string,
): ReservationDraftV1 | null {
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(draftKey(tenantId, n3UserKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReservationDraftV1>;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (parsed.tenantId !== tenantId || parsed.n3UserKey !== n3UserKey) return null;
    // Defensive: force identity numbers empty regardless of stored value.
    const guests = (parsed.guests ?? []).map((g) => ({ ...g, identityNumber: "" }));
    return {
      version: 1,
      tenantId,
      n3UserKey,
      savedAt: String(parsed.savedAt ?? ""),
      step: (parsed.step as DraftStep) ?? 1,
      arrival: String(parsed.arrival ?? ""),
      departure: String(parsed.departure ?? ""),
      bookingSource: String(parsed.bookingSource ?? ""),
      externalRef: String(parsed.externalRef ?? ""),
      notes: String(parsed.notes ?? ""),
      rooms: Array.isArray(parsed.rooms) ? (parsed.rooms as RoomDraft[]) : [],
      guests: guests as ReservationDraftV1["guests"],
    };
  } catch {
    return null;
  }
}

export function clearDraft(tenantId: string, n3UserKey: string): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(draftKey(tenantId, n3UserKey));
  } catch {
    /* ignore */
  }
}

/** Simple debounced-scheduler factory. */
export function createDraftScheduler(delayMs = 400) {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn: () => void) {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (handle) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}
