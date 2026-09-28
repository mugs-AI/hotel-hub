import { describe, expect, it } from "vitest";
import { humanDisplayName } from "@/lib/header-display";

describe("header person label", () => {
  it("shows a name, but never moves an email into the visible label", () => {
    expect(humanDisplayName("  N3 Owner  ")).toBe("N3 Owner");
    expect(humanDisplayName("QNE.MUGS@GMAIL.COM")).toBeNull();
    expect(humanDisplayName(null)).toBeNull();
  });
});
