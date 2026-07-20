// Regression test for Correction B, Task 1:
// PostgreSQL 42702 "column reference tenant_id is ambiguous" in
// public.hotelhub_provision_owner.
//
// Runs against the live Cloud DB via psql when PGHOST/PGUSER are set,
// otherwise skipped so CI without DB credentials still passes. Asserts:
//   - The RPC returns without ambiguity errors.
//   - Rerunning it is idempotent (exactly one active Owner row).
//   - Cross-tenant provisioning (unknown n3_tenant_key) is rejected.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const hasPg = Boolean(process.env.PGHOST && process.env.PGUSER);
const d = hasPg ? describe : describe.skip;

function psql(sql: string): { stdout: string; ok: boolean; err?: string } {
  try {
    const stdout = execFileSync("psql", ["-Atqc", sql], { encoding: "utf8" });
    return { stdout: stdout.trim(), ok: true };
  } catch (e) {
    const err = (e as { stderr?: Buffer }).stderr?.toString() ?? (e as Error).message;
    return { stdout: "", ok: false, err };
  }
}

d("hotelhub_provision_owner (live DB)", () => {
  const testUser = `regression-provision-${Date.now()}`;
  let tenantKey = "";

  it("selects a real tenant to test against", () => {
    const res = psql("SELECT n3_tenant_key FROM public.hotel_tenants LIMIT 1;");
    expect(res.ok).toBe(true);
    tenantKey = res.stdout;
    expect(tenantKey.length).toBeGreaterThan(0);
  });

  it("invokes the RPC without any 42702 / ambiguity error", () => {
    const res = psql(
      `SELECT out_role FROM public.hotelhub_provision_owner('${tenantKey}', '${testUser}');`,
    );
    expect(res.err ?? "").not.toContain("ambiguous");
    expect(res.err ?? "").not.toContain("42702");
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe("owner");
  });

  it("is idempotent — rerunning does not create a duplicate role row", () => {
    psql(`SELECT out_role FROM public.hotelhub_provision_owner('${tenantKey}', '${testUser}');`);
    const count = psql(
      `SELECT count(*) FROM public.hotel_user_roles WHERE n3_user_key = '${testUser}' AND is_active = true;`,
    );
    expect(count.stdout).toBe("1");
  });

  it("rejects cross-tenant / unknown n3_tenant_key", () => {
    const res = psql(
      `SELECT out_role FROM public.hotelhub_provision_owner('__does_not_exist__', '${testUser}');`,
    );
    expect(res.ok).toBe(false);
    expect(res.err ?? "").toMatch(/No hotel_tenants row/);
  });

  it("cleans up the regression row", () => {
    psql(`DELETE FROM public.hotel_user_roles WHERE n3_user_key = '${testUser}';`);
    psql(`DELETE FROM public.hotel_audit_events WHERE n3_user_key = '${testUser}';`);
  });
});
