import { expect, it } from "vitest";
import {
  parseSecurityCommand,
  parseSecurityPolicy,
  securityMoney,
  securityCsvCell,
} from "../security-cash";
it("rejects client-selected payout amounts and methods", () => {
  expect(() =>
    parseSecurityCommand({
      action: "reserve_return",
      holdingId: "11111111-1111-4111-8111-111111111111",
      version: "22222222-2222-4222-8222-222222222222",
      recipient: "Guest",
      cents: 1,
    }),
  ).toThrow("security_invalid_request");
  expect(() => parseSecurityCommand({ action: "confirm_return", method: "bank" })).toThrow(
    "security_invalid_request",
  );
});
it("does not accept unsafe/fractional or zero policy amounts", () => {
  for (const amountCents of [0, -1, NaN, 9007199254740992, 50.1])
    expect(() =>
      parseSecurityPolicy({ amountCents, required: true, terms: "Cash", version: "0" }),
    ).toThrow();
  expect(
    parseSecurityPolicy({ amountCents: 5000, required: true, terms: "Cash", version: "0" }),
  ).toMatchObject({ amountCents: 5000 });
});
it("rejects tenant/actor injection and noncash collection", () => {
  const b = {
    action: "collect",
    roomStayId: "11111111-1111-4111-8111-111111111111",
    payer: "Guest",
    recipient: "Guest",
    storage: "Envelope",
    method: "cash",
    policyVersion: "0",
  };
  expect(() => parseSecurityCommand({ ...b, tenantId: "evil" })).toThrow();
  expect(() => parseSecurityCommand({ ...b, method: "bank" })).toThrow("security_cash_only");
  expect(parseSecurityCommand(b)).toEqual(b);
});
it("shows exact cents on local cash receipt", () => expect(securityMoney(5000)).toBe("RM 50.00"));

it("CSV exports neutralize guest-entered spreadsheet formulas", () => {
  expect(securityCsvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
  expect(securityCsvCell(-100)).toBe('"-100"');
});
