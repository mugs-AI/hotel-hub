// Session-scoped New Reservation draft recovery + in-memory identity vault.
//
// - Versioned sessionStorage record scoped by (tenantId, n3UserKey).
// - NEVER persists raw identity numbers to any web-storage surface.
//   `guests[].identityNumber` is always stripped before write and never
//   restored from storage.
// - Raw identity numbers only ever live in a browser-memory-only Map,
//   scoped by (tenantId, n3UserKey, clientGuestId). Lost on refresh/close.
// - NEVER persists N3 tokens, tenant secrets, role, or session data.
// - Debounced writes: callers use `scheduler.schedule()` so keystrokes
//   don't thrash storage; the scheduler exposes `.cancel()` for unmount
//   and successful-submit cleanup.
import type { GuestDraft, RoomDraft } from "@/lib/reservations-ui";

export const DRAFT_VERSION = 2;
export const DRAFT_KEY_PREFIX = "hotelhub:new-reservation-draft:v2";

export type DraftStep = 1 | 2 | 3 | 4;

/** Guest as persisted in the draft — never contains a raw identity number. */
export type DraftGuest = Omit<GuestDraft, "identityNumber"> & {
  identityNumber: "";
};

export type ReservationDraftV2 = {
  version: 2;
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
  guests: DraftGuest[];
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
): DraftGuest[] {
  return guests.map((g) => ({ ...g, identityNumber: "" }));
}

export type DraftInput = Omit<ReservationDraftV2, "version" | "savedAt">;

export function serializeDraft(input: DraftInput): ReservationDraftV2 {
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
): ReservationDraftV2 | null {
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(draftKey(tenantId, n3UserKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReservationDraftV2>;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (parsed.tenantId !== tenantId || parsed.n3UserKey !== n3UserKey) return null;
    // Defensive: force identity numbers empty regardless of stored value.
    const guests = (parsed.guests ?? []).map((g) => ({
      ...g,
      identityNumber: "" as const,
    }));
    return {
      version: 2,
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
      guests: guests as DraftGuest[],
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

/** Debounced-save scheduler. Callers MUST call `cancel()` on unmount and
 *  immediately before clearing state or navigating away, so a pending
 *  write never resurrects freshly-cleared state. */
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

// ---------------------------------------------------------------------------
// Browser-memory-only identity vault.
//
// Scoped by (tenantId, n3UserKey, clientGuestId). The clientGuestId is a
// random client-only string assigned by `emptyGuestDraft` and preserved
// across draft save/restore — but the raw identity value NEVER touches
// storage. Refresh/close destroys the Map, so the user re-enters.
// ---------------------------------------------------------------------------

type VaultKey = string;
function vaultKey(tenantId: string, n3UserKey: string, clientGuestId: string): VaultKey {
  return `${tenantId}\u0001${n3UserKey}\u0001${clientGuestId}`;
}

const identityVault = new Map<VaultKey, string>();

export function vaultSetIdentity(
  tenantId: string,
  n3UserKey: string,
  clientGuestId: string,
  raw: string,
): void {
  if (!tenantId || !n3UserKey || !clientGuestId) return;
  const trimmed = raw ?? "";
  if (trimmed.length === 0) {
    identityVault.delete(vaultKey(tenantId, n3UserKey, clientGuestId));
    return;
  }
  identityVault.set(vaultKey(tenantId, n3UserKey, clientGuestId), trimmed);
}

export function vaultGetIdentity(
  tenantId: string,
  n3UserKey: string,
  clientGuestId: string,
): string {
  if (!tenantId || !n3UserKey || !clientGuestId) return "";
  return identityVault.get(vaultKey(tenantId, n3UserKey, clientGuestId)) ?? "";
}

export function vaultDeleteIdentity(
  tenantId: string,
  n3UserKey: string,
  clientGuestId: string,
): void {
  identityVault.delete(vaultKey(tenantId, n3UserKey, clientGuestId));
}

/** Purge every identity for a given user (call on successful create or discard). */
export function vaultClearForUser(tenantId: string, n3UserKey: string): void {
  const prefix = `${tenantId}\u0001${n3UserKey}\u0001`;
  for (const key of Array.from(identityVault.keys())) {
    if (key.startsWith(prefix)) identityVault.delete(key);
  }
}

/** Test/inspection helper — never referenced from UI code. */
export function __vaultSizeForTest(): number {
  return identityVault.size;
}

/** Generate a stable client-only guest id (browser-safe fallback). */
export function newClientGuestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
