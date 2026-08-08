/**
 * Run 5D2.5 §13.1 — N3-only authentication guardrail.
 *
 * HotelHub resolves identity exclusively through the N3 launch/session flow.
 * Browser Supabase auth must never come back, even if code generation
 * recreates the generated files.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

describe("Run 5D2.5 — N3-only auth guardrail", () => {
  const startSrc = readFileSync(resolve(root, "start.ts"), "utf8");

  it("src/start.ts declares functionMiddleware: []", () => {
    expect(startSrc).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });

  it("src/start.ts does not import or use attachSupabaseAuth", () => {
    expect(startSrc).not.toMatch(/attachSupabaseAuth/);
  });

  it("src/start.ts keeps the error middleware and N3 root launch interceptor", () => {
    expect(startSrc).toMatch(/errorMiddleware/);
    expect(startSrc).toMatch(/rootTokenInterceptor/);
  });

  it.each([
    "integrations/supabase/auth-attacher.ts",
    "integrations/supabase/auth-middleware.ts",
    "integrations/supabase/client.ts",
  ])("browser Supabase auth file %s is absent", (rel) => {
    expect(existsSync(resolve(root, rel))).toBe(false);
  });
});
