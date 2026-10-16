import { describe, expect, it } from "vitest";
import {
  accountantCaseKey,
  applyAccountantEvent,
  accountantAsAtCutoff,
  projectAccountantCases,
  snapshotAccountantPage,
  validateAccountantObservation,
  type AccountantCaseRow,
  type AccountantCaseHistory,
} from "../accountant-cases";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row = (): AccountantCaseRow => ({
  caseId: "11111111-1111-4111-8111-111111111111",
  version: "1",
  key: {
    reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    intentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "receipt_surplus",
    documentIds: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  },
  bookingReference: "SYNTHETIC-BOOKING",
  stayFrom: "2026-10-01",
  stayTo: "2026-10-02",
  documentReferences: [
    { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", code: "SYNTHETIC-OR", date: "2026-10-01" },
  ],
  currency: "MYR",
  firstSeen: "2026-10-01T03:00:00.000Z",
  lastChecked: null,
  status: "open",
  observation: {
    available: false,
    checkedAt: "2026-10-01T03:00:00.000Z",
    evidenceDigest: null,
    observedAmountCents: null,
    outcomeCode: "receipt_remainder_unavailable",
  },
  nextAction: "Check the same receipt in N3",
  notes: [],
});
const history = (): AccountantCaseHistory => ({
  tenantId,
  caseId: row().caseId,
  events: [{ at: row().firstSeen, row: row() }],
});
const input = (asAt: string) => ({ asAt, status: "open" as const, offset: 0, limit: 20 });
const now = "2026-12-05T03:00:00.000Z",
  started = "2026-10-01T00:00:00.000Z";
describe("accountant cases and recorded history", () => {
  it("PostgreSQL_UTC_offsets_and_operation_money_cap_are_supported", () => {
    const r = { ...row(), firstSeen: "2026-10-01T03:00:00+00:00" };
    expect(
      applyAccountantEvent(
        r,
        { kind: "review", reason: "Synthetic review", observation: null, proofDigest: null },
        "2026-10-02T03:00:00+00:00",
      ).status,
    ).toBe("reviewed");
    expect(() =>
      validateAccountantObservation({
        available: true,
        checkedAt: started,
        evidenceDigest: "a".repeat(64),
        observedAmountCents: 1_000_000_001,
        outcomeCode: "observed",
      }),
    ).toThrow();
  });
  it("prior_month_case_carries_forward", () => {
    for (const day of ["2026-11-30", "2026-12-05"]) {
      const page = projectAccountantCases(tenantId, [history()], input(day), started, now);
      expect(page.rows.map((r) => r.caseId)).toEqual([row().caseId]);
      expect(page.rows[0].observation.observedAmountCents).toBeNull();
    }
  });
  it("resolved_case_visible_in_earlier_statement", () => {
    const h = history();
    const october = projectAccountantCases(tenantId, [h], input("2026-10-31"), started, now);
    const saved = snapshotAccountantPage(october),
      bytes = JSON.stringify(saved);
    const resolved = applyAccountantEvent(
      row(),
      {
        kind: "resolve",
        reason: "Synthetic verified result",
        observation: {
          available: true,
          checkedAt: "2026-11-05T03:00:00.000Z",
          evidenceDigest: "a".repeat(64),
          observedAmountCents: 0,
          outcomeCode: "verified",
        },
        proofDigest: "b".repeat(64),
      },
      "2026-11-05T03:00:00.000Z",
    );
    h.events.push({ at: "2026-11-05T03:00:00.000Z", row: resolved });
    expect(
      projectAccountantCases(tenantId, [h], input("2026-12-05"), started, now).rows,
    ).toHaveLength(0);
    expect(
      projectAccountantCases(tenantId, [h], input("2026-10-31"), started, now).rows[0].status,
    ).toBe("open");
    expect(JSON.stringify(saved)).toBe(bytes);
    expect(Object.isFrozen(saved.rows[0])).toBe(true);
  });
  it("review_is_not_resolution", () => {
    const reviewed = applyAccountantEvent(
      row(),
      { kind: "review", reason: "Read by accountant", observation: null, proofDigest: null },
      "2026-10-02T03:00:00.000Z",
    );
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.version).toBe("2");
    expect(row().status).toBe("open");
  });
  it("contradictory_fresh_facts_reopen", () => {
    const resolved = {
      ...row(),
      status: "resolved" as const,
      observation: {
        available: true,
        checkedAt: started,
        evidenceDigest: "a".repeat(64),
        observedAmountCents: 0,
        outcomeCode: "verified",
      },
    };
    const reopened = applyAccountantEvent(
      resolved,
      {
        kind: "observe",
        reason: "Fresh conflicting observation",
        observation: {
          ...resolved.observation,
          checkedAt: "2026-11-01T03:00:00.000Z",
          evidenceDigest: "c".repeat(64),
          observedAmountCents: 100,
        },
        proofDigest: null,
      },
      "2026-11-01T03:00:00.000Z",
    );
    expect(reopened.status).toBe("open");
  });
  it("unavailable_amount_not_zero", () => {
    expect(
      projectAccountantCases(tenantId, [history()], input("2026-10-31"), started, now).rows[0]
        .observation.observedAmountCents,
    ).toBeNull();
    expect(() =>
      applyAccountantEvent(
        row(),
        {
          kind: "observe",
          reason: "Synthetic",
          observation: { ...row().observation, observedAmountCents: 0 },
          proofDigest: null,
        },
        started,
      ),
    ).toThrow();
  });
  it("foreign_tenant_case_denied", () => {
    expect(() =>
      projectAccountantCases(
        tenantId,
        [{ ...history(), tenantId: "other" }],
        input("2026-10-31"),
        started,
        now,
      ),
    ).toThrow("accountant_scope_mismatch");
  });
  it("historical_state_before_capture_is_unavailable", () => {
    const page = projectAccountantCases(tenantId, [history()], input("2026-09-30"), started, now);
    expect(page.complete).toBe(false);
    expect(() => snapshotAccountantPage(page)).toThrow("accountant_history_unavailable");
  });
  it("as_at_uses_the_end_of_the_Malaysia_day", () => {
    expect(accountantAsAtCutoff("2026-10-31", now)).toBe("2026-10-31T15:59:59.999Z");
    expect(() => accountantAsAtCutoff("2026-02-30", now)).toThrow();
    expect(() => accountantAsAtCutoff("2027-01-01", now)).toThrow();
  });
  it("stable_key_sorts_documents_and_rejects_duplicates", () => {
    const key = row().key;
    const id2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect(accountantCaseKey({ ...key, documentIds: [id2, ...key.documentIds] })).toEqual(
      accountantCaseKey({ ...key, documentIds: [...key.documentIds, id2] }),
    );
    expect(() =>
      accountantCaseKey({ ...key, documentIds: [...key.documentIds, ...key.documentIds] }),
    ).toThrow();
  });
  it("partial_page_cannot_be_saved_as_a_complete_statement", () => {
    const h = history(),
      second = history();
    second.caseId = second.events[0].row.caseId = "22222222-2222-4222-8222-222222222222";
    const page = projectAccountantCases(
      tenantId,
      [h, second],
      { ...input("2026-10-31"), limit: 1 },
      started,
      now,
    );
    expect(page.complete).toBe(false);
    expect(page.nextOffset).toBe(1);
    expect(() => snapshotAccountantPage(page)).toThrow();
  });
});
