#!/usr/bin/env bash
set -euo pipefail
# Never uses SUPABASE_URL or DATABASE_URL. Never creates/drops a database.
: "${HH_TEST_PG_URL:?Set an explicitly disposable local hh_test_ database URL}"
: "${HH_TEST_PG_DISPOSABLE:?Set YES only for a disposable database}"
: "${HH_PG_TEST_MODULE:?Absolute external pg package module path, no product dependency}"
node --input-type=module -e '
const u = new URL(process.env.HH_TEST_PG_URL);
if (!["postgres:","postgresql:"].includes(u.protocol) || !["localhost","127.0.0.1","[::1]"].includes(u.hostname) || !/^\/hh_test_[a-z0-9_]+$/.test(u.pathname) || u.search || process.env.HH_TEST_PG_DISPOSABLE !== "YES") throw new Error("Refusing non-disposable or remote PostgreSQL target");
'
node node_modules/vitest/vitest.mjs run src/lib/__tests__/receipt-automation-postgres.test.ts
