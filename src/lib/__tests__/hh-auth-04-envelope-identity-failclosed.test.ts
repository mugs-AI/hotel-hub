// HH-AUTH-04 audit correction — fail-closed neutral envelope + identity claims.
//
// 1. Neutral validation only accepts a positively successful official N3
//    ApiResponseMessage envelope. Anything else on a 2xx is "malformed".
// 2. Identity extraction fails closed when recognized immutable user-ID or
//    tenant-ID claims contradict each other. Email / username never authorize.
import { describe, expect, it } from "vitest";
import {
  extractValidatedIdentity,
  interpretNeutralValidation,
} from "@/lib/n3-token-validation";

const baseTenant = { tenantId: "tenant-1" };

describe("HH-AUTH-04 — neutral envelope requires positive success", () => {
  it.each([
    ["code 0000", { code: "0000", data: null }],
    ["Code 0000", { Code: "0000" }],
    ["numeric code 0", { code: 0 }],
    ["success true", { success: true }],
    ["Success true", { Success: true }],
    ["code 0000 + success true", { code: "0000", success: true, message: "OK" }],
  ])("accepts explicitly successful envelope: %s", (_label, body) => {
    expect(interpretNeutralValidation(200, body).status).toBe("accepted");
  });

  it.each([
    ["bare empty object", {}],
    ["null body (204/no body)", null],
    ["undefined body", undefined],
    ["array body", [{ code: "0000" }]],
    ["unrelated 2xx payload", { value: "hotelhub.session.probe", data: { x: 1 } }],
    ["string body", "OK"],
    ["unsuccessful code", { code: "1001" }],
    ["numeric non-zero code", { code: 5 }],
    ["success false", { success: false }],
    ["contradiction: code ok, success false", { code: "0000", success: false }],
    ["contradiction: success true, code bad", { code: "1001", success: true }],
    ["unrecognized code shape", { code: { v: "0000" }, success: true }],
    ["unrecognized success shape", { code: "0000", success: "true" }],
  ])("rejects as malformed: %s", (_label, body) => {
    expect(interpretNeutralValidation(200, body).status).toBe("malformed");
  });

  it("keeps 204 with no body fail-closed", () => {
    expect(interpretNeutralValidation(204, null).status).toBe("malformed");
  });

  it("keeps transport verdicts unchanged", () => {
    expect(interpretNeutralValidation(401, { code: "0000" }).status).toBe("rejected");
    expect(interpretNeutralValidation(403, { code: "0000" }).status).toBe("forbidden");
    expect(interpretNeutralValidation(500, { code: "0000" }).status).toBe("unavailable");
    expect(interpretNeutralValidation(302, null).status).toBe("unavailable");
  });
});

describe("HH-AUTH-04 — identity extraction fails closed on ambiguity", () => {
  it("accepts sub alone", () => {
    const out = extractValidatedIdentity({ sub: "user-1", ...baseTenant });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.identity.n3UserKey).toBe("user-1");
  });

  it("accepts matching sub plus alternate immutable ID claims", () => {
    const out = extractValidatedIdentity({
      sub: "User-1",
      userId: "user-1",
      nameid: "USER-1",
      ...baseTenant,
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.identity.n3UserKey).toBe("User-1");
  });

  it("accepts an alternate immutable ID when sub is absent", () => {
    const out = extractValidatedIdentity({ userId: "user-9", ...baseTenant });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.identity.n3UserKey).toBe("user-9");
  });

  it.each([
    ["sub vs userId", { sub: "user-1", userId: "user-2" }],
    ["sub vs uid", { sub: "user-1", uid: "user-3" }],
    ["sub vs nameid", { sub: "user-1", nameid: "other" }],
    ["userId vs UserId (no sub)", { userId: "a", UserId: "b" }],
  ])("rejects conflicting user-ID claims: %s", (_label, claims) => {
    expect(extractValidatedIdentity({ ...claims, ...baseTenant }).status).toBe("ambiguous_user");
  });

  it("rejects conflicting tenant-ID claims", () => {
    expect(extractValidatedIdentity({ sub: "u", tenantId: "t1", companyId: "t2" }).status).toBe(
      "ambiguous_tenant",
    );
  });

  it("rejects conflicting tenant-code claims", () => {
    expect(extractValidatedIdentity({ sub: "u", tenantCode: "AA", dbCode: "BB" }).status).toBe(
      "ambiguous_tenant",
    );
  });

  it("still requires an immutable user id — email/username cannot authorize", () => {
    const out = extractValidatedIdentity({
      email: "jonas@example.com",
      name: "Jonas",
      preferred_username: "jonas",
      ...baseTenant,
    });
    expect(out.status).toBe("missing_user");
  });

  it("still requires a tenant identity", () => {
    expect(extractValidatedIdentity({ sub: "user-1" }).status).toBe("missing_tenant");
  });

  it("never returns email/userName as the authorization key", () => {
    const out = extractValidatedIdentity({
      sub: "user-1",
      email: "jonas@example.com",
      name: "Jonas",
      ...baseTenant,
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.identity.n3UserKey).toBe("user-1");
      expect(out.identity.email).toBe("jonas@example.com");
      expect(out.identity.userName).toBe("Jonas");
    }
  });
});
