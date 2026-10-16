import { readFileSync } from "node:fs";
import { connectTest } from "./hh-settlement-pg-client.mjs";
let client;
try {
  client = await connectTest({ empty: true });
  await client.query("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
  await client.query(readFileSync("db/checks/hh-settlement-setup.sql", "utf8"));
  await client.query(readFileSync("db/checks/hh-settlement-seed.sql", "utf8"));
  await client.query("SET check_function_bodies=on");
  await client.query(
    readFileSync("supabase/migrations/20261008080000_hh_billing_settlement.sql", "utf8"),
  );
  client.on("notice", (n) => {
    if (n.message.startsWith("PASS")) console.log(n.message);
  });
  await client.query(readFileSync("db/checks/hh-settlement-single.sql", "utf8"));
  console.log("PASS native PostgreSQL17.6 setup and single-session checks");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client?.end();
}
