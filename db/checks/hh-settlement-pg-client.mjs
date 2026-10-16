// Test-only tools are installed separately; never add them to application dependencies.
import { createRequire } from "node:module";
import { resolve } from "node:path";
const toolPath =
  process.env.HH_SQL_TEST_TOOLS || ".superpowers/sdd/2026-10-08-n3-billing-settlement/pg-client";
const requireTool = createRequire(resolve(toolPath, "package.json"));
export function testTarget() {
  const value = process.env.HH_TEST_PG_URL;
  if (!value)
    throw new Error("NOT VERIFIED: HH_TEST_PG_URL for disposable PostgreSQL 17.6 is missing");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    decodeURIComponent(url.pathname) !== "/hh_settlement_test"
  )
    throw new Error("Refused: requires loopback database named hh_settlement_test");
  // Reject connection query overrides (host/options/service could redirect the target).
  if (url.search) throw new Error("Refused: connection query overrides");
  return value;
}
export async function connectTest({ empty = false } = {}) {
  const connectionString = testTarget();
  const { Client } = requireTool("pg");
  const client = new Client({
    connectionString,
    statement_timeout: 15000,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT current_database() AS db,current_setting('server_version') AS version",
    );
    if (rows[0].db !== "hh_settlement_test" || rows[0].version.split(" ")[0] !== "17.6")
      throw new Error("Refused: database identity/version mismatch");
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if (empty) {
      if (tables.rows.length) throw new Error("Refused: setup requires empty disposable database");
    } else {
      if (!tables.rows.some((r) => r.tablename === "hh_settlement_test_marker"))
        throw new Error("Refused: dedicated test marker missing");
      const marker = await client.query("SELECT identity FROM public.hh_settlement_test_marker");
      if (marker.rows.length !== 1 || marker.rows[0].identity !== "hh_settlement_test")
        throw new Error("Refused: wrong test marker");
    }
    return client;
  } catch (err) {
    await client.end();
    throw err;
  }
}
