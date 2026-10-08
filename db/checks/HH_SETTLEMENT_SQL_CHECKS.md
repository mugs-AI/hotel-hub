# Settlement SQL acceptance

This is a staged candidate, not a database release. No command in this folder calls N3.

Prerequisites were read from the actual Lovable Cloud PostgreSQL 17.6 catalog on 08/10/2026. `hh-settlement-prerequisites.json` records their hashes. The fixture contains schema, functions and triggers with synthetic data only. It does not blindly replay repository migrations, and excludes unapplied automatic receipt-control work. Existing migration files are unchanged.

Install test-only tools outside application dependency files:

```sh
npm install --prefix .superpowers/sdd/2026-10-08-n3-billing-settlement/pg-client --no-save --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14 pg@8.16.3
```

Single-session fallback:

```sh
node db/checks/hh-settlement-pglite.mjs
```

PGlite can establish executed constraint, rollback and function behavior; it cannot establish multi-session locking. This result must never be promoted into a concurrency PASS.

Native acceptance requires an empty, dedicated PostgreSQL **17.6** database named `hh_settlement_test` on loopback. Set `HH_TEST_PG_URL` privately. The setup runner refuses non-loopback hosts, other database names, connection query overrides, wrong versions and populated databases. The multi-session runner additionally requires the dedicated identity marker before creating synthetic cases. Never use a tunnel to the operational backend.

```sh
node db/checks/hh-settlement-postgres-setup.mjs
node db/checks/hh-settlement-multisession.mjs
```

The native runner uses independent PostgreSQL client connections with bounded statement timeouts. It checks exactly one winner among 20 workers, both deposit/freeze race orders, pending-row visibility, and rollback rather than deadlock for a child-first direct update. A missing target or failed check exits nonzero with NOT VERIFIED/FAIL. Review still must add remaining whole-vertical close/proof/concurrency assertions as later tasks supply those behaviors.

Local execution currently cannot start native PostgreSQL: the shell runs as root and user switching is denied. PG17.6 binaries are available, but PostgreSQL refuses root. No protection was bypassed. Native multi-session acceptance remains **NOT VERIFIED**, blocking activation. No real financial writer is mounted by this checkpoint.
