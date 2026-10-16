import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  reservation: { status: "confirmed", arrivalDate: "2026-09-26", departureDate: "2026-09-27" },
  rpc: vi.fn(),
  from: vi.fn(() => {
    throw new Error("housekeeping reached");
  }),
}));
vi.mock("../reservations-store.server", async (load) => ({
  ...(await load<object>()),
  getReservationById: async () => state.reservation,
}));
vi.mock("../hotel-store.server", () => ({
  getOrCreateHotelSettings: async () => ({
    standardCheckInTime: "15:00",
    timezone: "Asia/Kuala_Lumpur",
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: state.rpc, from: state.from },
}));
import { checkInReservation } from "../reservation-operations.server";

describe("server check-in date preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it.each([false, true])(
    "rejects expired dates before housekeeping or mutation, early=%s",
    async (allowEarly) => {
      await expect(
        checkInReservation({
          tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          actorN3UserKey: "fixture-user",
          expectedUpdatedAt: null,
          allowEarly,
        }),
      ).rejects.toMatchObject({ code: "stay_dates_expired" });
      expect(state.from).not.toHaveBeenCalled();
      expect(state.rpc).not.toHaveBeenCalled();
    },
  );
});
