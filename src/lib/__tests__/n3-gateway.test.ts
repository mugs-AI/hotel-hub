import { describe, expect, it } from "vitest";
import { isProbeName, listProbes, callN3Path } from "@/lib/n3-gateway.server";

describe("N3 gateway allowlist", () => {
  it("advertises exactly the three approved probes", () => {
    const names = listProbes()
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["companyprofile", "customers", "stocks"]);
  });

  it("rejects any probe name outside the allowlist", () => {
    expect(isProbeName("companyprofile")).toBe(true);
    expect(isProbeName("customers")).toBe(true);
    expect(isProbeName("stocks")).toBe(true);
    // Attempted escapes.
    expect(isProbeName("companyprofile/../secrets")).toBe(false);
    expect(isProbeName("../etc/passwd")).toBe(false);
    expect(isProbeName("customers?admin=true")).toBe(false);
    expect(isProbeName("stocks/create")).toBe(false);
    expect(isProbeName("https://evil.example")).toBe(false);
    expect(isProbeName("")).toBe(false);
    expect(isProbeName(undefined)).toBe(false);
  });

  it("callN3Path rejects unsafe paths without touching the network", async () => {
    await expect(callN3Path("token", "/etc/passwd")).rejects.toThrow(/must be under \/api\//);
    await expect(callN3Path("token", "/api/../secrets")).rejects.toThrow(/unsafe path/);
    await expect(callN3Path("token", "https://evil.example/api/x")).rejects.toThrow();
  });
});
