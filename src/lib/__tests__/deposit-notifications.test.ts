import { expect, it } from "vitest";
import { createDepositNoticeObserver } from "../deposit-notifications";
const event = {
  revision: "2",
  requestId: "req",
  bookingReference: "BK-TEST",
  docCode: "OR-TEST",
  currency: "MYR",
  beforeCents: 7000,
  afterCents: 6000,
};
it("baselines historical successes without emitting, emits a fresh committed event once", () => {
  const observer = createDepositNoticeObserver();
  expect(
    observer.observe("t:u:front_desk", { cursor: "1", events: [{ ...event, revision: "1" }] }),
  ).toEqual([]);
  expect(observer.observe("t:u:front_desk", { cursor: "2", events: [event] })).toEqual([event]);
  expect(observer.observe("t:u:front_desk", { cursor: "2", events: [event] })).toEqual([]);
});
it("auth switch and reload baseline without replaying another scope", () => {
  const o = createDepositNoticeObserver();
  o.observe("t:u:front_desk", { cursor: "1", events: [] });
  expect(o.observe("alien:v:front_desk", { cursor: "2", events: [event] })).toEqual([]);
  o.observe(null, null);
  expect(o.observe("t:u:front_desk", { cursor: "2", events: [event] })).toEqual([]);
  expect(
    createDepositNoticeObserver().observe("t:u:front_desk", { cursor: "2", events: [event] }),
  ).toEqual([]);
});
it("transient failure retains cursor and never emits; old/invalid packets fail closed", () => {
  const o = createDepositNoticeObserver();
  o.observe("t:u:front_desk", { cursor: "1", events: [] });
  expect(o.observe("t:u:front_desk", null)).toEqual([]);
  expect(o.cursor("t:u:front_desk")).toBe("1");
  expect(
    o.observe("t:u:front_desk", { cursor: "2", events: [{ ...event, afterCents: NaN }] }),
  ).toEqual([]);
  expect(o.cursor("t:u:front_desk")).toBe("1");
  expect(o.observe("t:u:front_desk", { cursor: "2", events: [event] })).toEqual([event]);
  expect(o.observe("t:u:front_desk", { cursor: "1", events: [] })).toEqual([]);
  expect(o.cursor("t:u:front_desk")).toBe("2");
});
it("uses exact bigint cursors and preserves delivery across bounded pages", () => {
  const o = createDepositNoticeObserver();
  o.observe("t:u:front_desk", { cursor: "9007199254740992", events: [] });
  const e = { ...event, revision: "9007199254740993" };
  expect(o.observe("t:u:front_desk", { cursor: e.revision, events: [e] })).toEqual([e]);
});
