/**
 * Milestone 1.1.1 Correction A.1 — N3-only identity regression tests.
 *
 * Locks in the durable cleanup: no production file may import the deleted
 * browser-auth-only generated modules, and `src/start.ts` must expose
 * exactly `functionMiddleware: []`.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function rg(pattern: string): string {
  try {
    return execFileSync(
      "rg",
      [
        "-n",
        "--no-heading",
        "--glob",
        "!**/__tests__/**",
        "--glob",
        "!**/*.test.ts",
        "--glob",
        "!**/*.test.tsx",
        pattern,
        "src",
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    // ripgrep exits 1 when no matches — that's the success case here.
    if (e.status === 1) return "";
    throw err;
  }
}

describe("Correction A.1 — N3-only identity", () => {
  const startSrc = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");

  it("src/start.ts contains functionMiddleware: []", () => {
    expect(startSrc).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });

  it("src/start.ts does not reference attachSupabaseAuth", () => {
    expect(startSrc).not.toMatch(/attachSupabaseAuth/);
  });

  it("no production file imports auth-attacher", () => {
    expect(rg("from ['\"].*supabase/auth-attacher['\"]")).toBe("");
  });

  it("no production file imports requireSupabaseAuth", () => {
    // Match import statements only — narrative comments about the removed
    // middleware are fine.
    expect(rg("import[^\\n]*requireSupabaseAuth")).toBe("");
  });

  it("no production file imports the browser Supabase client", () => {
    expect(rg("from ['\"]@/integrations/supabase/client['\"]")).toBe("");
  });

});
