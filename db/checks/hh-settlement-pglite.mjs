// Single-session SQL proof only. This runner cannot establish concurrent locks.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const toolsPath =
  process.env.HH_SQL_TEST_TOOLS || ".superpowers/sdd/2026-10-08-n3-billing-settlement/pg-client";
const req = createRequire(resolve(toolsPath, "package.json"));
const { PGlite } = req("@electric-sql/pglite");
const { btree_gist } = req("@electric-sql/pglite/contrib/btree_gist");
const db = new PGlite({
  extensions: { btree_gist },
  onNotice: (n) => {
    if (n.message.startsWith("PASS")) console.log(n.message);
  },
});
try {
  await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off;");
  await db.exec(readFileSync("db/checks/hh-settlement-setup.sql", "utf8"));
  console.log("PASS reconstructed read-only baseline schema");
  await db.exec(readFileSync("db/checks/hh-settlement-seed.sql", "utf8"));
  await db.exec("SET check_function_bodies=on");
  await db.exec(
    readFileSync("supabase/migrations/20261008080000_hh_billing_settlement.sql", "utf8"),
  );
  console.log("PASS candidate applies once to disposable schema");
  await db.exec(readFileSync("db/checks/hh-settlement-single.sql", "utf8"), {
    onNotice: (n) => {
      if (n.message.startsWith("PASS")) console.log(n.message);
    },
  });
  console.log("PASS single-session checks; concurrency NOT VERIFIED");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
