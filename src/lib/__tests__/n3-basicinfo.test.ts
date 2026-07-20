import { describe, expect, it } from "vitest";
import { normalizeBasicInfo, pickAuthoritativeEmail } from "@/lib/n3-basicinfo";

describe("normalizeBasicInfo", () => {
  it("handles PascalCase N3 keys", () => {
    const result = normalizeBasicInfo({
      TenantId: "tenant-guid-1",
      TenantCode: "BOUTIQUE01",
      CompanyName: "Boutique Hotel Sdn Bhd",
      Email: "owner@boutique.test",
      UserName: "Alice Owner",
    });
    expect(result.n3TenantKey).toBe("tenant-guid-1");
    expect(result.tenantCode).toBe("BOUTIQUE01");
    expect(result.companyName).toBe("Boutique Hotel Sdn Bhd");
    expect(result.userEmail).toBe("owner@boutique.test");
    expect(result.userName).toBe("Alice Owner");
  });

  it("handles camelCase N3 keys", () => {
    const result = normalizeBasicInfo({
      tenantId: "tenant-guid-2",
      tenantCode: "BOUTIQUE02",
      companyName: "Second Boutique",
      email: "front@boutique.test",
    });
    expect(result.n3TenantKey).toBe("tenant-guid-2");
    expect(result.tenantCode).toBe("BOUTIQUE02");
    expect(result.userEmail).toBe("front@boutique.test");
  });

  it("falls back to tenant code when no immutable id is provided", () => {
    const result = normalizeBasicInfo({
      TenantCode: "CODE-ONLY",
      CompanyName: "No Guid Hotel",
    });
    expect(result.n3TenantKey).toBe("CODE-ONLY");
  });

  it("falls back to JWT claims for identity when BasicInfo omits them", () => {
    const result = normalizeBasicInfo(
      { CompanyName: "Claim Fallback Hotel" },
      { tenantId: "claim-tenant", email: "claim@user.test" },
    );
    expect(result.n3TenantKey).toBe("claim-tenant");
    expect(result.userEmail).toBe("claim@user.test");
  });

  it("returns null identity when nothing is available", () => {
    const result = normalizeBasicInfo({});
    expect(result.n3TenantKey).toBeNull();
    expect(result.userEmail).toBeNull();
  });
});

describe("pickAuthoritativeEmail (Correction B: no concatenation)", () => {
  it("returns exactly one string when both profile and JWT provide an email", () => {
    const result = pickAuthoritativeEmail(
      { Email: "lks.mugs@gmail.com" },
      { email: "lks.mugs@gmail.com" },
    );
    expect(result).toBe("lks.mugs@gmail.com");
    expect(result?.length).toBe("lks.mugs@gmail.com".length);
  });

  it("prefers profile email over JWT email — never combines them", () => {
    const result = pickAuthoritativeEmail(
      { Email: "profile@example.test" },
      { email: "jwt@example.test" },
    );
    expect(result).toBe("profile@example.test");
    expect(result).not.toContain("jwt@example.test");
  });

  it("falls back to JWT email only when profile omits it", () => {
    expect(pickAuthoritativeEmail({}, { email: "jwt-only@example.test" })).toBe(
      "jwt-only@example.test",
    );
    expect(pickAuthoritativeEmail({ Email: "" }, { email: "jwt-only@example.test" })).toBe(
      "jwt-only@example.test",
    );
  });

  it("returns null when neither source has an email", () => {
    expect(pickAuthoritativeEmail({}, {})).toBeNull();
  });

  it("normalizeBasicInfo.userEmail is a single non-doubled value", () => {
    const r = normalizeBasicInfo(
      { Email: "lks.mugs@gmail.com", UserName: "lks.mugs@gmail.com" },
      { email: "lks.mugs@gmail.com" },
    );
    expect(r.userEmail).toBe("lks.mugs@gmail.com");
    // Regression: catches any accidental concatenation like "a@x.coma@x.co".
    const doubled = "lks.mugs@gmail.comlks.mugs@gmail.com";
    expect(r.userEmail).not.toBe(doubled);
    expect(r.userEmail?.length).toBeLessThan(doubled.length);
  });
});
