// HH-GOLIVE-01A correction — race-safe operation claims.
//
// The canonical applied SQL is inspected here without re-executing it, so the
// concurrency contract is proven two ways:
//
//   1. EXECUTABLE MODEL TESTS — an in-memory transactional model that mirrors
//      the SQL exactly: the operation-key unique index is a serialization
//      point (INSERT ... ON CONFLICT DO NOTHING blocks on a concurrent
//      uncommitted insert), a claim is only visible to other transactions
//      after commit, and locks are released at transaction end. Two
//      genuinely interleaved async "transactions" are run against it.
//   2. SQL CONTRACT TESTS — the applied file must keep the exact statement
//      ORDER the model relies on (lock -> claim -> state decision), exactly
//      one operation-key unique index, and a complete rollback manifest.
//
// Real PostgreSQL concurrency is covered by the separately recorded database
// acceptance evidence; this suite preserves the source-level contract.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = "supabase/migrations/20260827162500_33f5b427-d39d-4caf-bc85-df7c4ca6ab01.sql";
const sql = readFileSync(resolve(process.cwd(), SQL_PATH), "utf8");

// --------------------------------------------------------------- the model

type Result = Record<string, unknown> & { ok: boolean };

class LockManager {
  private tails = new Map<string, Promise<void>>();
  async acquire(key: string): Promise<() => void> {
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const prev = this.tails.get(key) ?? Promise.resolve();
    this.tails.set(
      key,
      prev.then(() => mine),
    );
    await prev;
    return release;
  }
}

type OpRow = {
  tenantId: string;
  operation: string;
  reservationId: string;
  folioId: string | null;
  targetLineId: string | null;
  clientRequestId: string;
  fingerprint: string;
  resultLineId: string | null;
  resultEvidenceId: string | null;
};

type LineRow = {
  id: string;
  folioId: string;
  lineType: string;
  status: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  version: number;
};

/** Mirrors the staged SQL functions, including their statement ordering. */
class FolioModel {
  readonly locks = new LockManager();
  readonly ops = new Map<string, OpRow>();
  readonly lines = new Map<string, LineRow>();
  readonly evidence = new Map<string, { id: string; reservationId: string; amount: number }>();
  readonly folios = new Map<string, string>(); // reservationId -> folioId
  private seq = 0;
  /** Every physical row insert increments this: the write counter. */
  writes = 0;

  id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private opKey(t: string, op: string, rid: string): string {
    return `${t}|${op}|${rid}`;
  }

  /** hotelhub_claim_folio_operation: atomic insert-or-resolve. */
  private async claim(
    tx: Array<() => void>,
    input: {
      tenantId: string;
      operation: string;
      reservationId: string;
      folioId: string | null;
      targetLineId: string | null;
      clientRequestId: string;
      fingerprint: string;
    },
  ): Promise<Result> {
    const key = this.opKey(input.tenantId, input.operation, input.clientRequestId);
    // Serialization point == the single operation-key unique index. Held for
    // the whole transaction, exactly like an uncommitted conflicting insert.
    tx.push(await this.locks.acquire(`op:${key}`));
    const existing = this.ops.get(key);
    if (!existing) {
      this.ops.set(key, {
        tenantId: input.tenantId,
        operation: input.operation,
        reservationId: input.reservationId,
        folioId: input.folioId,
        targetLineId: input.targetLineId,
        clientRequestId: input.clientRequestId,
        fingerprint: input.fingerprint,
        resultLineId: null,
        resultEvidenceId: null,
      });
      return { ok: true, replay: false, claimed: true };
    }
    if (
      existing.fingerprint !== input.fingerprint ||
      existing.reservationId !== input.reservationId ||
      (existing.folioId ?? null) !== input.folioId ||
      (existing.targetLineId ?? null) !== input.targetLineId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    return {
      ok: true,
      replay: true,
      lineId: existing.resultLineId,
      evidenceId: existing.resultEvidenceId,
    };
  }

  private release(tenantId: string, operation: string, clientRequestId: string): void {
    this.ops.delete(this.opKey(tenantId, operation, clientRequestId));
  }

  private commit(tx: Array<() => void>): void {
    for (const r of tx.reverse()) r();
  }

  async addLine(p: {
    tenantId: string;
    reservationId: string;
    operation: "folio.add_addon" | "folio.adjustment";
    quantity: number;
    unitPriceCents: number;
    clientRequestId: string;
    fingerprint: string;
  }): Promise<Result> {
    const tx: Array<() => void> = [];
    try {
      if (p.quantity < 1) return { ok: false, code: "quantity_invalid" };
      tx.push(await this.locks.acquire(`folio:${p.tenantId}:${p.reservationId}`));
      const folioId = this.folios.get(p.reservationId);
      if (!folioId) return { ok: false, code: "folio_not_found" };
      const claim = await this.claim(tx, {
        ...p,
        folioId,
        targetLineId: null,
      });
      if (!claim.ok) return claim;
      if (claim.replay) return { ok: true, replay: true, lineId: claim.lineId };
      const id = this.id("line");
      this.lines.set(id, {
        id,
        folioId,
        lineType: "add_on",
        status: "draft",
        quantity: p.quantity,
        unitPriceCents: p.unitPriceCents,
        subtotalCents: p.quantity * p.unitPriceCents,
        version: 1,
      });
      this.writes += 1;
      this.ops.get(this.opKey(p.tenantId, p.operation, p.clientRequestId))!.resultLineId = id;
      return { ok: true, replay: false, lineId: id };
    } finally {
      this.commit(tx);
    }
  }

  async updateQuantity(p: {
    tenantId: string;
    reservationId: string;
    lineId: string;
    expectedVersion: number;
    quantity: number;
    clientRequestId: string;
    fingerprint: string;
  }): Promise<Result> {
    const operation = "folio.update_quantity";
    const tx: Array<() => void> = [];
    try {
      if (p.quantity < 1) return { ok: false, code: "quantity_invalid" };
      tx.push(await this.locks.acquire(`folio:${p.tenantId}:${p.reservationId}`));
      const folioId = this.folios.get(p.reservationId);
      if (!folioId) return { ok: false, code: "folio_not_found" };
      tx.push(await this.locks.acquire(`line:${p.lineId}`));
      const line = this.lines.get(p.lineId);
      if (!line || line.folioId !== folioId) return { ok: false, code: "line_not_found" };
      const claim = await this.claim(tx, {
        ...p,
        operation,
        folioId,
        targetLineId: p.lineId,
      });
      if (!claim.ok) return claim;
      if (claim.replay) {
        // Exact retry replays even though the version has advanced.
        return { ok: true, replay: true, lineId: claim.lineId ?? p.lineId, version: line.version };
      }
      let code: string | null = null;
      if (line.lineType === "room_night") code = "room_night_not_editable";
      else if (line.status !== "draft") code = "line_not_editable";
      else if (line.version !== p.expectedVersion) code = "version_conflict";
      if (code) {
        this.release(p.tenantId, operation, p.clientRequestId);
        return { ok: false, code };
      }
      line.quantity = p.quantity;
      line.subtotalCents = p.quantity * line.unitPriceCents;
      line.version += 1;
      this.writes += 1;
      this.ops.get(this.opKey(p.tenantId, operation, p.clientRequestId))!.resultLineId = p.lineId;
      return { ok: true, replay: false, lineId: p.lineId, version: line.version };
    } finally {
      this.commit(tx);
    }
  }

  async reverse(p: {
    tenantId: string;
    reservationId: string;
    lineId: string;
    clientRequestId: string;
    fingerprint: string;
  }): Promise<Result> {
    const operation = "folio.reverse";
    const tx: Array<() => void> = [];
    try {
      tx.push(await this.locks.acquire(`folio:${p.tenantId}:${p.reservationId}`));
      const folioId = this.folios.get(p.reservationId);
      if (!folioId) return { ok: false, code: "folio_not_found" };
      tx.push(await this.locks.acquire(`line:${p.lineId}`));
      const line = this.lines.get(p.lineId);
      if (!line || line.folioId !== folioId) return { ok: false, code: "line_not_found" };
      const claim = await this.claim(tx, { ...p, operation, folioId, targetLineId: p.lineId });
      if (!claim.ok) return claim;
      if (claim.replay) return { ok: true, replay: true, lineId: claim.lineId };
      let code: string | null = null;
      if (line.lineType === "room_night") code = "room_night_not_reversible";
      else if (line.lineType === "reversal") code = "line_not_reversible";
      else if (line.status === "reversed") code = "already_reversed";
      if (code) {
        this.release(p.tenantId, operation, p.clientRequestId);
        return { ok: false, code };
      }
      const id = this.id("rev");
      this.lines.set(id, {
        id,
        folioId,
        lineType: "reversal",
        status: "committed",
        quantity: 1,
        unitPriceCents: -line.unitPriceCents,
        subtotalCents: -line.subtotalCents,
        version: 1,
      });
      this.writes += 1;
      line.status = "reversed";
      this.ops.get(this.opKey(p.tenantId, operation, p.clientRequestId))!.resultLineId = id;
      return { ok: true, replay: false, lineId: id };
    } finally {
      this.commit(tx);
    }
  }

  async addEvidence(p: {
    tenantId: string;
    reservationId: string;
    amountCents: number;
    clientRequestId: string;
    fingerprint: string;
  }): Promise<Result> {
    const operation = "folio.tourism_tax_evidence";
    const tx: Array<() => void> = [];
    try {
      if (p.amountCents < 0) return { ok: false, code: "amount_invalid" };
      const claim = await this.claim(tx, {
        ...p,
        operation,
        folioId: null,
        targetLineId: null,
      });
      if (!claim.ok) return claim;
      if (claim.replay) return { ok: true, replay: true, evidenceId: claim.evidenceId };
      const id = this.id("ev");
      this.evidence.set(id, { id, reservationId: p.reservationId, amount: p.amountCents });
      this.writes += 1;
      this.ops.get(this.opKey(p.tenantId, operation, p.clientRequestId))!.resultEvidenceId = id;
      return { ok: true, replay: false, evidenceId: id };
    } finally {
      this.commit(tx);
    }
  }
}

function seeded(): FolioModel {
  const m = new FolioModel();
  m.folios.set("res-1", "folio-1");
  m.folios.set("res-2", "folio-2");
  return m;
}

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

// ------------------------------------------------------------------ tests

describe("race-safe add-line claim (model)", () => {
  it("two simultaneous identical claims write once and replay once", async () => {
    const m = seeded();
    const call = () =>
      m.addLine({
        tenantId: "t1",
        reservationId: "res-1",
        operation: "folio.add_addon",
        quantity: 2,
        unitPriceCents: 500,
        clientRequestId: "req-1",
        fingerprint: FP_A,
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.ok && b.ok).toBe(true);
    // Exactly one physical write, and no unique-violation path.
    expect(m.writes).toBe(1);
    expect(m.lines.size).toBe(1);
    const replays = [a, b].filter((r) => r.replay === true);
    expect(replays).toHaveLength(1);
    // The replay resolves the winner's stored line id.
    expect(a.lineId).toBe(b.lineId);
    expect(typeof a.lineId).toBe("string");
  });

  it("same key with a different body fingerprint conflicts and writes nothing", async () => {
    const m = seeded();
    const first = await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_A,
    });
    expect(first.ok).toBe(true);
    const conflict = await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 9,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_B,
    });
    expect(conflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(m.writes).toBe(1);
  });

  it("same key against another reservation conflicts and writes nothing", async () => {
    const m = seeded();
    await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_A,
    });
    const other = await m.addLine({
      tenantId: "t1",
      reservationId: "res-2",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_A,
    });
    expect(other.code).toBe("idempotency_conflict");
    expect(m.writes).toBe(1);
  });

  it("the same key under a different operation is a separate claim", async () => {
    const m = seeded();
    await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_A,
    });
    const adj = await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.adjustment",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-1",
      fingerprint: FP_A,
    });
    expect(adj.ok).toBe(true);
    expect(adj.replay).toBe(false);
    expect(m.writes).toBe(2);
  });
});

describe("quantity update ordering (model)", () => {
  async function withLine() {
    const m = seeded();
    const created = await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 500,
      clientRequestId: "req-create",
      fingerprint: FP_A,
    });
    return { m, lineId: created.lineId as string };
  }

  it("exact retry after the version advanced returns the original result", async () => {
    const { m, lineId } = await withLine();
    const p = {
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      expectedVersion: 1,
      quantity: 3,
      clientRequestId: "req-q",
      fingerprint: FP_A,
    };
    const first = await m.updateQuantity(p);
    expect(first).toMatchObject({ ok: true, replay: false, version: 2 });
    expect(m.lines.get(lineId)!.version).toBe(2);
    // Same payload, same key, but the row version is now 2 (stale expected).
    const retry = await m.updateQuantity(p);
    expect(retry.ok).toBe(true);
    expect(retry.replay).toBe(true);
    expect(retry.lineId).toBe(lineId);
    expect(retry.code).toBeUndefined();
    expect(m.lines.get(lineId)!.quantity).toBe(3);
  });

  it("two simultaneous exact retries apply once", async () => {
    const { m, lineId } = await withLine();
    const p = {
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      expectedVersion: 1,
      quantity: 4,
      clientRequestId: "req-q",
      fingerprint: FP_A,
    };
    const [a, b] = await Promise.all([m.updateQuantity(p), m.updateQuantity(p)]);
    expect(a.ok && b.ok).toBe(true);
    expect([a.replay, b.replay].filter(Boolean)).toHaveLength(1);
    expect(m.lines.get(lineId)!.version).toBe(2);
    expect(m.lines.get(lineId)!.quantity).toBe(4);
  });

  it("a version conflict leaves no replayable success claim", async () => {
    const { m, lineId } = await withLine();
    await m.updateQuantity({
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      expectedVersion: 1,
      quantity: 2,
      clientRequestId: "req-first",
      fingerprint: FP_A,
    });
    const stale = await m.updateQuantity({
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      expectedVersion: 1,
      quantity: 7,
      clientRequestId: "req-stale",
      fingerprint: FP_B,
    });
    expect(stale).toEqual({ ok: false, code: "version_conflict" });
    // No empty claim survived, so a later identical request is a real attempt,
    // not a false replay.
    expect(m.ops.has("t1|folio.update_quantity|req-stale")).toBe(false);
    const again = await m.updateQuantity({
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      expectedVersion: 2,
      quantity: 7,
      clientRequestId: "req-stale",
      fingerprint: FP_B,
    });
    expect(again).toMatchObject({ ok: true, replay: false, version: 3 });
  });

  it("an unknown line writes nothing and claims nothing", async () => {
    const { m } = await withLine();
    const res = await m.updateQuantity({
      tenantId: "t1",
      reservationId: "res-1",
      lineId: "line-missing",
      expectedVersion: 1,
      quantity: 2,
      clientRequestId: "req-x",
      fingerprint: FP_A,
    });
    expect(res).toEqual({ ok: false, code: "line_not_found" });
    expect(m.ops.has("t1|folio.update_quantity|req-x")).toBe(false);
  });
});

describe("reversal ordering (model)", () => {
  async function withLine() {
    const m = seeded();
    const created = await m.addLine({
      tenantId: "t1",
      reservationId: "res-1",
      operation: "folio.add_addon",
      quantity: 1,
      unitPriceCents: 900,
      clientRequestId: "req-create",
      fingerprint: FP_A,
    });
    return { m, lineId: created.lineId as string };
  }

  it("a concurrent exact retry returns the original reversal, not already_reversed", async () => {
    const { m, lineId } = await withLine();
    const p = {
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      clientRequestId: "req-rev",
      fingerprint: FP_A,
    };
    const [a, b] = await Promise.all([m.reverse(p), m.reverse(p)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.lineId).toBe(b.lineId);
    expect([a.replay, b.replay].filter(Boolean)).toHaveLength(1);
    // One add-on + exactly one reversal line.
    expect(m.lines.size).toBe(2);
    expect(m.lines.get(lineId)!.status).toBe("reversed");
  });

  it("a different request against an already reversed line is deterministic", async () => {
    const { m, lineId } = await withLine();
    await m.reverse({
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      clientRequestId: "req-rev",
      fingerprint: FP_A,
    });
    const other = await m.reverse({
      tenantId: "t1",
      reservationId: "res-1",
      lineId,
      clientRequestId: "req-other",
      fingerprint: FP_B,
    });
    expect(other).toEqual({ ok: false, code: "already_reversed" });
    expect(m.lines.size).toBe(2);
    expect(m.ops.has("t1|folio.reverse|req-other")).toBe(false);
  });
});

describe("tourism tax evidence claim (model)", () => {
  it("exact replay resolves the original evidence row", async () => {
    const m = seeded();
    const p = {
      tenantId: "t1",
      reservationId: "res-1",
      amountCents: 1000,
      clientRequestId: "req-ev",
      fingerprint: FP_A,
    };
    const first = await m.addEvidence(p);
    const replay = await m.addEvidence(p);
    expect(first.ok && replay.ok).toBe(true);
    expect(replay.replay).toBe(true);
    expect(replay.evidenceId).toBe(first.evidenceId);
    expect(m.evidence.size).toBe(1);
  });

  it("two simultaneous identical evidence claims store one row", async () => {
    const m = seeded();
    const p = {
      tenantId: "t1",
      reservationId: "res-1",
      amountCents: 1000,
      clientRequestId: "req-ev",
      fingerprint: FP_A,
    };
    const [a, b] = await Promise.all([m.addEvidence(p), m.addEvidence(p)]);
    expect(m.evidence.size).toBe(1);
    expect(a.evidenceId).toBe(b.evidenceId);
    expect([a.replay, b.replay].filter(Boolean)).toHaveLength(1);
  });

  it("conflicting reuse of the key is rejected and writes nothing", async () => {
    const m = seeded();
    await m.addEvidence({
      tenantId: "t1",
      reservationId: "res-1",
      amountCents: 1000,
      clientRequestId: "req-ev",
      fingerprint: FP_A,
    });
    const conflict = await m.addEvidence({
      tenantId: "t1",
      reservationId: "res-1",
      amountCents: 2500,
      clientRequestId: "req-ev",
      fingerprint: FP_B,
    });
    expect(conflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(m.evidence.size).toBe(1);
  });
});

// ----------------------------------------------- SQL contract (statement order)

function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("applied SQL contract", () => {
  it("declares exactly one operation-key unique index", () => {
    const creates = sql.match(/create unique index if not exists hotel_folio_operations_key_uidx/g);
    expect(creates).toHaveLength(1);
  });

  it("claims atomically with insert ... on conflict do nothing, not select-then-insert", () => {
    const body = fnBody("hotelhub_claim_folio_operation");
    expect(body).toMatch(
      /insert into public\.hotel_folio_operations[\s\S]*on conflict \(tenant_id, operation, client_request_id\) do nothing[\s\S]*returning id into v_new_id/,
    );
    // The duplicate path re-reads under a lock and never surfaces a raw
    // constraint error.
    expect(body.indexOf("on conflict")).toBeLessThan(body.indexOf("for update"));
    expect(body).toContain("idempotency_conflict");
  });

  it("orders the quantity update as folio lock -> line lock -> claim -> decisions", () => {
    const body = fnBody("hotelhub_update_folio_line_quantity");
    const folioLock = body.indexOf("from public.hotel_folios f");
    const lineLock = body.indexOf("from public.hotel_folio_lines");
    const claim = body.indexOf("hotelhub_claim_folio_operation");
    const version = body.indexOf("version_conflict");
    const update = body.indexOf("update public.hotel_folio_lines");
    expect(folioLock).toBeLessThan(lineLock);
    expect(lineLock).toBeLessThan(claim);
    expect(claim).toBeLessThan(version);
    expect(version).toBeLessThan(update);
    expect(body).toContain("hotelhub_release_folio_operation");
  });

  it("re-checks the reversal claim after the line lock and before already_reversed", () => {
    const body = fnBody("hotelhub_reverse_folio_line");
    const lineLock = body.indexOf("from public.hotel_folio_lines");
    const claim = body.indexOf("hotelhub_claim_folio_operation");
    const reversed = body.indexOf("'already_reversed'");
    expect(lineLock).toBeLessThan(claim);
    expect(claim).toBeLessThan(reversed);
    expect(body).toContain("hotelhub_release_folio_operation");
  });

  it("resolves the original evidence row on replay", () => {
    const body = fnBody("hotelhub_add_tourism_tax_evidence");
    expect(body).toMatch(/'evidenceId', v_claim->>'evidenceId'/);
    expect(body).toContain("set result_evidence_id = v_id");
    expect(sql).toContain("result_evidence_id uuid");
  });

  it("keeps RLS enabled with no browser policies and service-role-only execution", () => {
    for (const table of [
      "hotel_folio_operations",
      "hotel_folio_lines",
      "hotel_folios",
      "hotel_tourism_tax_evidence",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`grant all on public.${table} to service_role`);
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(
      /grant\s+(all|execute|select|insert|update|delete)[^\n]*to (anon|authenticated)/i,
    );
    for (const fn of [
      "hotelhub_claim_folio_operation",
      "hotelhub_release_folio_operation",
      "hotelhub_add_folio_line",
      "hotelhub_update_folio_line_quantity",
      "hotelhub_add_tourism_tax_evidence",
      "hotelhub_reverse_folio_line",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn}(`);
    }
  });

  it("carries a complete rollback manifest for every created object", () => {
    const header = sql.slice(
      0,
      sql.indexOf("-- ---------------------------------------------------------------- enums"),
    );
    for (const object of [
      "hotel_folio_lines_room_night_immutable",
      "hotelhub_add_tourism_tax_evidence",
      "hotelhub_update_folio_line_quantity",
      "hotelhub_add_folio_line",
      "hotelhub_reverse_folio_line",
      "hotelhub_claim_folio_operation",
      "hotelhub_folio_room_night_immutable",
      "hotel_folio_operations",
      "hotel_tourism_tax_evidence",
      "hotel_reservation_tax_profile",
      "hotel_folio_lines",
      "hotel_folios",
      "hotel_financial_settings",
      "hotel_addon_catalogue",
      "hotel_guest_tax_class",
      "hotel_folio_line_status",
      "hotel_folio_line_type",
      "hotel_tax_class",
      "hotel_addon_category",
    ]) {
      expect(header).toContain(object);
    }
  });

  it("uses the canonical applied migration path", () => {
    expect(SQL_PATH.startsWith("supabase/migrations/")).toBe(true);
    expect(SQL_PATH).toContain("33f5b427-d39d-4caf-bc85-df7c4ca6ab01");
  });
});
