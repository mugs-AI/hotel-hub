import { describe, it, expect } from "vitest";
import { settlementReaderMatches, settlementRevisionChanged } from "../settlement-view";
describe("confirmed settlement reader refresh", () => {
  it("covers every named reader at the current tenant or legacy reservation scope", () => {
    for (const key of [
      ["reservations", "detail", "t", "r"],
      ["reservations", "list", "t", "status=checked_in"],
      ["deposits", "tenant", "r"],
      ["folio", "tenant", "r"],
      ["reservation", "r"],
      ["reservation-operations", "r"],
      ["reservation-timeline", "r"],
      ["reservation-timeline", "t", "r"],
      ["checkout-preview", "r"],
      ["departures", "t", ""],
      ["housekeeping", "board", "t"],
      ["reservation-calendar", "t", "2026-10"],
      ["financial-reporting", "t:u:owner", "report", "2026-10"],
      ["receipt-controls", "t:u:owner", "queue"],
    ])
      expect(settlementReaderMatches(key, "t", "r"), JSON.stringify(key)).toBe(true);
  });
  it("does not invalidate another tenant/reservation or settlement itself", () => {
    for (const key of [
      ["reservations", "detail", "t", "other"],
      ["folio", "tenant", "other"],
      ["reservations", "list", "other", ""],
      ["departures", "other", ""],
      ["financial-reporting", "other:u:owner", "report"],
      ["settlement", "t", "u", "r"],
    ])
      expect(settlementReaderMatches(key, "t", "r")).toBe(false);
  });
  it("refreshes only a confirmed persisted revision, including closed and cross-device views", () => {
    expect(settlementRevisionChanged(null, "12")).toBe(false);
    expect(settlementRevisionChanged("12", "12")).toBe(false);
    expect(settlementRevisionChanged("12", undefined)).toBe(false);
    expect(settlementRevisionChanged("12", "13")).toBe(true);
    expect(settlementRevisionChanged("9007199254740992", "9007199254740993")).toBe(true);
  });
});
