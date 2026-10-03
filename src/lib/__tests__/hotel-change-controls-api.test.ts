import { describe, expect, it } from "vitest";
import {
  validateChangePolicyInput,
  missingChangeInstallation,
} from "../hotel-change-controls-store.server";
describe("change policy boundary", () => {
  it("accepts only independently boolean controls and a decimal revision", () => {
    expect(
      validateChangePolicyInput({
        expectedRevision: "9007199254740993",
        depositApprovalRequired: true,
        contactApprovalRequired: false,
      }).expectedRevision,
    ).toBe("9007199254740993");
    for (const body of [
      { expectedRevision: 0, depositApprovalRequired: true, contactApprovalRequired: false },
      { expectedRevision: "0", depositApprovalRequired: 1, contactApprovalRequired: false },
      {
        expectedRevision: "0",
        depositApprovalRequired: true,
        contactApprovalRequired: false,
        role: "owner",
      },
    ])
      expect(() => validateChangePolicyInput(body)).toThrow();
  });
  it("only absent schema is missing installation, authorization/read failures fail closed", () => {
    expect(missingChangeInstallation({ code: "42P01" })).toBe(true);
    expect(missingChangeInstallation({ code: "PGRST205" })).toBe(true);
    for (const code of ["42501", "PGRST301", "57014", "42703"])
      expect(missingChangeInstallation({ code })).toBe(false);
  });
});
