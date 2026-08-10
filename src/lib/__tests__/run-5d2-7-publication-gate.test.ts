/**
 * Run 5D2.7 — publication gate regression tests.
 *
 * Covers the three verified blockers closed in this run:
 *   A. N3-only authentication boundary restored and guarded.
 *   B. No raw replacement identity number in Query mutation variables or in
 *      the client idempotency signature.
 *   C. Server idempotency fingerprint is a keyed HMAC bound to the actual
 *      replacement identity number.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSafeUpdateSignature,
  newIdentityRevision,
  type SafeSignatureInput,
} from "../reservation-update-signature";
import { nextRequestId } from "../idempotency";
import { normalizeFullUpdateBody } from "../reservation-full-update";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/** A fake, well-formed MyKad-shaped value used only inside these tests. */
const NUMBER_A = "880101101234";
const NUMBER_B = "990202105678";
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "x".repeat(48);

// ---------------------------------------------------------------- 8.1 auth

describe("5D2.7 §8.1 — N3-only auth guardrail", () => {
  const startSrc = read("start.ts");

  it("src/start.ts declares functionMiddleware: []", () => {
    expect(startSrc).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });

  it("src/start.ts never imports or uses attachSupabaseAuth", () => {
    expect(startSrc).not.toMatch(/attachSupabaseAuth/);
  });

  it("errorMiddleware and rootTokenInterceptor stay in the active request path", () => {
    expect(startSrc).toMatch(
      /requestMiddleware:\s*\[\s*errorMiddleware\s*,\s*rootTokenInterceptor\s*\]/,
    );
  });

  it.each([
    "integrations/supabase/auth-attacher.ts",
    "integrations/supabase/auth-middleware.ts",
    "integrations/supabase/client.ts",
  ])("browser Supabase auth file %s is absent", (rel) => {
    expect(existsSync(resolve(root, rel))).toBe(false);
  });
});

// ------------------------------------------------------------- 8.2 privacy

function guest(overrides: Partial<SafeSignatureInput["guests"][number]> = {}) {
  return {
    clientKey: "rg-1",
    reservationGuestId: null,
    fullName: "Aisyah Binti Rahman",
    mobile: "0198887766",
    email: null,
    notes: null,
    nationalityCode: "MYS",
    addressLine1: null,
    addressLine2: null,
    addressLine3: null,
    city: null,
    postcode: null,
    countryCode: "MYS",
    stateCode: "SGR",
    stateProvince: null,
    isPrimary: true,
    assignedRoomClientKey: "rr-1",
    identityAction: "replace" as const,
    identityType: "mykad",
    identityRevision: "rev-1",
    ...overrides,
  };
}

function sigInput(g = guest()): SafeSignatureInput {
  return {
    reservationId: RESERVATION_ID,
    expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
    bookingSource: "walk_in",
    arrivalDate: "2026-08-10",
    departureDate: "2026-08-12",
    notes: null,
    externalBookingReference: null,
    correctionReason: null,
    rooms: [
      {
        clientKey: "rr-1",
        reservationRoomId: null,
        hotelRoomId: "22222222-2222-4222-8222-222222222222",
        agreedRate: 250,
        adults: 2,
        children: 0,
        rateOverrideReason: null,
        remark: null,
      },
    ],
    guests: [g],
  };
}

describe("5D2.7 §8.2 — client privacy", () => {
  const clientSrc = read("lib/reservations-client.ts");
  const editorSrc = read("routes/reservations.$id_.edit.tsx");

  it("the full update is a plain submit function, not a useMutation", () => {
    expect(clientSrc).toMatch(/export async function submitReservationFullUpdate/);
    expect(clientSrc).not.toMatch(/export function useUpdateReservationFull/);
    // No mutation is typed with the sensitive payload anywhere.
    expect(clientSrc).not.toMatch(/useMutation<[^>]*UpdateReservationFullPayload/s);
    expect(editorSrc).toMatch(/submitReservationFullUpdate\(/);
    expect(editorSrc).not.toMatch(/mutateAsync\(buildPayload/);
  });

  it("the editor still invalidates every affected query key on success", () => {
    expect(clientSrc).toMatch(/export function useInvalidateReservationUpdate/);
    for (const key of [
      "reservationDetailKey",
      "reservation-timeline",
      "reservation-calendar",
      "availability",
    ]) {
      expect(clientSrc).toContain(key);
    }
    expect(editorSrc).toMatch(/invalidateAfterUpdate\(\)/);
  });

  it("the safe signature never contains the raw identity number", () => {
    const sig = buildSafeUpdateSignature(sigInput());
    expect(sig).not.toContain(NUMBER_A);
    expect(sig).not.toContain(NUMBER_A.slice(-4));
    expect(sig).not.toMatch(/identityNumber/);
  });

  it("the safe signature is stable while the opaque revision is unchanged", () => {
    expect(buildSafeUpdateSignature(sigInput())).toBe(buildSafeUpdateSignature(sigInput()));
  });

  it("changing only the identity revision changes the signature and the request ID", () => {
    const a = buildSafeUpdateSignature(sigInput());
    const b = buildSafeUpdateSignature(sigInput(guest({ identityRevision: "rev-2" })));
    expect(a).not.toBe(b);
    const first = nextRequestId(null, a);
    const same = nextRequestId(first, a);
    const rotated = nextRequestId(first, b);
    expect(same.id).toBe(first.id);
    expect(rotated.id).not.toBe(first.id);
  });

  it("revision tokens are opaque and not derived from the identity value", () => {
    const r = newIdentityRevision();
    expect(r).not.toContain(NUMBER_A);
    expect(typeof r).toBe("string");
    expect(newIdentityRevision()).not.toBe(r);
  });

  it("identityRevision is rejected by the server payload allow-list", () => {
    const res = normalizeFullUpdateBody({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      bookingSource: "walk_in",
      arrivalDate: "2026-08-10",
      departureDate: "2026-08-12",
      rooms: [
        {
          clientKey: "rr-1",
          hotelRoomId: "22222222-2222-4222-8222-222222222222",
          agreedRate: 250,
          adults: 1,
          children: 0,
        },
      ],
      guests: [
        {
          clientKey: "rg-1",
          fullName: "Aisyah",
          isPrimary: true,
          assignedRoomClientKey: "rr-1",
          identityRevision: "rev-1",
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("unknown_field");
  });

  it("the editor never writes an identity number to storage, URL, toast or log", () => {
    expect(editorSrc).not.toMatch(/localStorage|sessionStorage/);
    expect(editorSrc).not.toMatch(/console\.(log|info|warn|error)\([^)]*identityNumber/);
    expect(editorSrc).not.toMatch(/toast\.[a-z]+\([^)]*identityNumber/);
    expect(editorSrc).toMatch(/autoComplete="off"/);
    // Replacement values are cleared from component memory on success.
    expect(editorSrc).toMatch(/identityNumber:\s*""/);
  });
});

// --------------------------------------------------------- 8.3 server HMAC

describe("5D2.7 §8.3 — server HMAC fingerprint", () => {
  const prev = process.env["HOTELHUB_SESSION_SECRET"];
  beforeEach(() => {
    process.env["HOTELHUB_SESSION_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env["HOTELHUB_SESSION_SECRET"];
    else process.env["HOTELHUB_SESSION_SECRET"] = prev;
  });

  function payload(identityAction: "keep" | "replace" | "clear", number: string | null) {
    const res = normalizeFullUpdateBody({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      bookingSource: "walk_in",
      arrivalDate: "2026-08-10",
      departureDate: "2026-08-12",
      rooms: [
        {
          clientKey: "rr-1",
          hotelRoomId: "22222222-2222-4222-8222-222222222222",
          agreedRate: 250,
          adults: 2,
          children: 0,
        },
      ],
      guests: [
        {
          clientKey: "rg-1",
          // keep/clear only apply to an already-persisted guest link.
          reservationGuestId: "55555555-5555-4555-8555-555555555555",
          fullName: "Aisyah Binti Rahman",
          isPrimary: true,
          assignedRoomClientKey: "rr-1",
          identityAction,
          identityType: identityAction === "replace" ? "mykad" : null,
          identityNumber: number,
        },
      ],
    });
    if (!res.ok) throw new Error(`fixture invalid: ${res.code}`);
    return res.value;
  }

  it("is deterministic for the same payload, reservation and secret", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    expect(fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A))).toBe(
      fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A)),
    );
  });

  it("differs when only the replacement identity number changes", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    expect(fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A))).not.toBe(
      fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_B)),
    );
  });

  it("differs across keep / clear / replace for the same visible payload", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    const keep = fullUpdateFingerprint(RESERVATION_ID, payload("keep", null));
    const clear = fullUpdateFingerprint(RESERVATION_ID, payload("clear", null));
    const replace = fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A));
    expect(new Set([keep, clear, replace]).size).toBe(3);
  });

  it("is bound to the reservation ID", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    expect(fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A))).not.toBe(
      fullUpdateFingerprint(
        "44444444-4444-4444-8444-444444444444",
        payload("replace", NUMBER_A),
      ),
    );
  });

  it("emits only an opaque versioned value and never the raw number or secret", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    const fp = fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A));
    expect(fp).toMatch(/^hhv3:[0-9a-f]{64}$/);
    expect(fp).not.toContain(NUMBER_A);
    expect(fp).not.toContain(SECRET);
  });

  it("changes with the secret (keyed HMAC, not an unkeyed hash)", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    const a = fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A));
    process.env["HOTELHUB_SESSION_SECRET"] = "y".repeat(48);
    const b = fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A));
    expect(a).not.toBe(b);
  });

  it("fails closed on a missing or too-short secret without leaking anything", async () => {
    const { fullUpdateFingerprint } = await import("../reservation-full-update-fingerprint.server");
    for (const bad of [undefined, "short"]) {
      if (bad === undefined) delete process.env["HOTELHUB_SESSION_SECRET"];
      else process.env["HOTELHUB_SESSION_SECRET"] = bad;
      let message = "";
      try {
        fullUpdateFingerprint(RESERVATION_ID, payload("replace", NUMBER_A));
        throw new Error("expected throw");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBe("reservation_update_failed");
      expect(message).not.toContain(NUMBER_A);
      expect(message).not.toContain("HOTELHUB_SESSION_SECRET");
    }
  });

  it("the shared pure module no longer owns fingerprinting", () => {
    const shared = read("lib/reservation-full-update.ts");
    expect(shared).not.toMatch(/export function canonicalFingerprint/);
    expect(shared).not.toMatch(/function digest\(/);
    expect(shared).not.toMatch(/HOTELHUB_SESSION_SECRET/);
  });

  it("the store derives the fingerprint server-side and passes it to the v2 RPC", () => {
    const store = read("lib/reservations-store.server.ts");
    expect(store).toMatch(/reservation-full-update-fingerprint\.server/);
    expect(store).toMatch(/p_fingerprint:\s*fingerprint/);
    expect(store).toMatch(/hotelhub_update_reservation_v2/);
  });

  it("the browser can never supply fingerprint, tenant, actor or role", () => {
    const shared = read("lib/reservation-full-update.ts");
    for (const forbidden of ["fingerprint", "tenantId", "actorN3UserKey", "actorRole"]) {
      expect(shared).not.toMatch(new RegExp(`ALLOWED_TOP[\\s\\S]*"${forbidden}"[\\s\\S]*\\]\\)`));
    }
    const bad = normalizeFullUpdateBody({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      bookingSource: "walk_in",
      arrivalDate: "2026-08-10",
      departureDate: "2026-08-12",
      rooms: [
        {
          clientKey: "rr-1",
          hotelRoomId: "22222222-2222-4222-8222-222222222222",
          agreedRate: 250,
          adults: 1,
          children: 0,
        },
      ],
      guests: [
        {
          clientKey: "rg-1",
          fullName: "Aisyah",
          isPrimary: true,
          assignedRoomClientKey: "rr-1",
        },
      ],
      fingerprint: "hhv3:deadbeef",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("unknown_field");
  });

  it("the server-only fingerprint module is never imported by browser code", () => {
    const editorSrc = read("routes/reservations.$id_.edit.tsx");
    const clientSrc = read("lib/reservations-client.ts");
    const sigSrc = read("lib/reservation-update-signature.ts");
    for (const src of [editorSrc, clientSrc, sigSrc]) {
      expect(src).not.toContain("reservation-full-update-fingerprint.server");
    }
  });
});

// ------------------------------------------------------- 8.4 submit/retry

describe("5D2.7 §8.4 — submission and retry", () => {
  it("a network error keeps the same request ID for an unchanged signature", () => {
    const sig = buildSafeUpdateSignature(sigInput());
    const first = nextRequestId(null, sig);
    // network_error path: no rotate() — the same signature resolves the same ID.
    expect(nextRequestId(first, sig).id).toBe(first.id);
  });

  it("changing the number back and forth still yields fresh request IDs", () => {
    const s1 = buildSafeUpdateSignature(sigInput(guest({ identityRevision: "r1" })));
    const s2 = buildSafeUpdateSignature(sigInput(guest({ identityRevision: "r2" })));
    const s3 = buildSafeUpdateSignature(sigInput(guest({ identityRevision: "r3" })));
    const a = nextRequestId(null, s1);
    const b = nextRequestId(a, s2);
    const c = nextRequestId(b, s3);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("an authoritative success rotates request-ID state and clears the input", () => {
    const editorSrc = read("routes/reservations.$id_.edit.tsx");
    const success = editorSrc.slice(editorSrc.indexOf("const result = await submitReservationFullUpdate"));
    expect(success).toMatch(/requestId\.rotate\(\)/);
    expect(success).toMatch(/identityNumber:\s*""/);
    expect(success).toMatch(/identityRevision:\s*newIdentityRevision\(\)/);
  });

  it("sanitized errors expose only a stable code, never a response body", () => {
    const clientSrc = read("lib/reservations-client.ts");
    expect(clientSrc).toMatch(/class ReservationApiError/);
    expect(clientSrc).toMatch(/network_error/);
    // The payload type may name the field; it must never be logged.
    expect(clientSrc).not.toMatch(/console\.[a-z]+\([^)]*identityNumber/);
  });
});
