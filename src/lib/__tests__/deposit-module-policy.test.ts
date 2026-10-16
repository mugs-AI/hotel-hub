import { describe, expect, it } from "vitest";
import {
  depositModuleCapabilities,
  parseDepositModulePolicy,
  legacyDepositModulePolicy,
} from "../deposit-module-policy";

describe("independent deposit collection policy", () => {
  it.each([
    [true, false, true, false],
    [false, true, false, true],
    [true, true, true, true],
    [false, false, false, false],
  ])("four_deposit_modes_independent: advance=%s security=%s", (advance, security, a, s) => {
    const policy = parseDepositModulePolicy({
      roomAdvanceEnabled: advance,
      securityDepositEnabled: security,
      version: "0",
    });
    expect(depositModuleCapabilities(policy, { advance: true, security: true })).toEqual({
      advance: a,
      security: s,
    });
  });
  it("security_toggle_cannot_enable_n3_refund_or_unaccepted_collection", () => {
    const policy = parseDepositModulePolicy({
      roomAdvanceEnabled: true,
      securityDepositEnabled: true,
      version: "0",
    });
    expect(depositModuleCapabilities(policy, { advance: false, security: false })).toEqual({
      advance: false,
      security: false,
    });
    expect(depositModuleCapabilities(policy, { advance: true, security: false })).toEqual({
      advance: true,
      security: false,
    });
  });
  it("legacy_defaults_preserved without enabling security", () => {
    expect(
      depositModuleCapabilities(legacyDepositModulePolicy(), { advance: true, security: true }),
    ).toEqual({ advance: true, security: false });
  });
  it.each([
    null,
    [],
    {},
    { roomAdvanceEnabled: "false", securityDepositEnabled: false, version: "0" },
    { roomAdvanceEnabled: true, securityDepositEnabled: null, version: "0" },
    { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "1" },
    { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0", tenantId: "fake" },
    { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0", refundEnabled: true },
  ])("rejects malformed/extra policy %j", (body) => {
    expect(() => parseDepositModulePolicy(body)).toThrow("invalid_deposit_module_policy");
  });
});
