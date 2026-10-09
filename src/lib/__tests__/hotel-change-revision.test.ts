import { describe, expect, it, vi } from "vitest";
import {
  createRevisionObserver,
  revisionPollInterval,
  invalidateRevisionEffects,
} from "../hotel-change-revision-client";
import { appendChangeRevision } from "../hotel-change-revision.server";
import { QueryClient } from "@tanstack/react-query";
import { purgeSensitiveReceiptData } from "../receipt-controls-client";
describe("cross-session revision metadata", () => {
  it("front desk revision refresh excludes Owner and foreign-identity financial queries", () => {
    const qc = new QueryClient();
    const staff = "t:staff:front_desk",
      owner = "t:owner:owner";
    const keys = [
      ["receipt-controls", staff, "reservation:r"],
      ["receipt-controls", owner, "queue"],
      ["folio-bill-to", staff, "r"],
      ["folio-bill-to", owner, "r"],
      ["hotel-change-policy", staff],
      ["hotel-change-policy", owner],
      ["bill-to-changes", owner],
      ["financial-reporting", owner],
    ];
    for (const key of keys) qc.setQueryData(key, { saved: true });
    invalidateRevisionEffects(qc, staff);
    expect(keys.map((key) => qc.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });
  it("Owner revision refresh invalidates own queues once without refreshing a foreign Owner", () => {
    const qc = new QueryClient();
    const keys = [
      ["financial-reporting", "t:a:owner"],
      ["financial-reporting", "t:b:owner"],
      ["bill-to-changes", "t:a:owner"],
      ["bill-to-changes", "t:b:owner"],
    ];
    for (const key of keys) qc.setQueryData(key, {});
    const observer = createRevisionObserver((identity) => invalidateRevisionEffects(qc, identity));
    observer.observe("t:a:owner", "1");
    observer.observe("t:a:owner", "2");
    expect(keys.map((key) => qc.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
  it("separate identities observe once and preserve huge decimal revisions without Number conversion", () => {
    const a = vi.fn(),
      b = vi.fn();
    const left = createRevisionObserver(a),
      right = createRevisionObserver(b);
    expect(left.observe("t:owner:owner", "9007199254740992")).toBe(false);
    expect(right.observe("t:staff:front_desk", "9007199254740992")).toBe(false);
    expect(left.observe("t:owner:owner", "9007199254740993")).toBe(true);
    expect(right.observe("t:staff:front_desk", "9007199254740993")).toBe(true);
    expect(left.observe("t:owner:owner", "9007199254740993")).toBe(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(left.observe(null, "4")).toBe(false);
    expect(left.observe("t:other:owner", "4")).toBe(false);
  });
  it("refreshes after a transient read failure without losing the prior revision", () => {
    const changed = vi.fn();
    const observer = createRevisionObserver(changed);
    observer.observe("t:u:front_desk", "1");
    observer.observe("t:u:front_desk", null);
    expect(observer.observe("t:u:front_desk", "2")).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    observer.observe(null, null);
    expect(observer.observe("t:u:front_desk", "3")).toBe(false);
  });
  it("polls at 2000ms only visible authorized sessions with installed metadata", () => {
    expect(revisionPollInterval("t:u:owner", true, true)).toBe(2000);
    expect(revisionPollInterval("t:u:front_desk", true, true)).toBe(2000);
    for (const identity of [null, "t:u:housekeeper"])
      expect(revisionPollInterval(identity, true, true)).toBe(false);
    expect(revisionPollInterval("t:u:owner", false, true)).toBe(false);
    expect(revisionPollInterval("t:u:owner", true, false)).toBe(false);
  });
  it("extends financial revision without replacing existing deposit/request/version components", () => {
    expect(appendChangeRevision("version|request|deposit", "9007199254740993")).toBe(
      "version|request|deposit|change:9007199254740993",
    );
    expect(appendChangeRevision("old", null)).toBe("old");
  });
  it("auth transition purges policy/bill-to/proposal/revision query and mutation results", () => {
    const qc = new QueryClient();
    for (const prefix of [
      "hotel-change-policy",
      "folio-bill-to",
      "bill-to-changes",
      "hotel-change-revision",
    ]) {
      qc.setQueryData([prefix, "t:owner:owner"], { private: true });
      qc.getMutationCache().build(qc, { mutationKey: [prefix, "t:owner:owner", "save"] });
    }
    purgeSensitiveReceiptData(qc, "t:front:front_desk");
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });
});
