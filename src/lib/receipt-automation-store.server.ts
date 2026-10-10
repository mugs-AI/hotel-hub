/* eslint-disable @typescript-eslint/no-explicit-any -- additive schema service-role adapter */
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import type { ReceiptAutomationMeta } from "./receipt-automation";
import type { ChangePolicy } from "./hotel-change-controls";
import type {
  ReceiptSnapshot,
  ReceiptControlProposal,
  ReceiptComparison,
  ReceiptContactFields,
} from "./receipt-controls";
import { ReceiptControlError } from "./receipt-controls";
import {
  mapReceiptRequestRow,
  type RequestRow,
  type VersionPayload,
} from "./receipt-controls-store.server";
import { changeAdmin, changeRpc, changeDbError } from "./hotel-change-controls-store.server";
export type EditAttempt = {
  id: string;
  claimedVersion: number;
  payloadHash: string;
  phase: "reserved" | "confirmed" | "rejected" | "unknown";
};
export type AutomationRequestRow = RequestRow & {
  generation: 1 | 2;
  automation: ReceiptAutomationMeta | null;
  attempt: EditAttempt | null;
};
export type AutomationCreateRecord = {
  reservationId: string;
  depositId: string;
  clientRequestId: string;
  fingerprint: string;
  reason: string;
  original: ReceiptSnapshot;
  proposal: ReceiptControlProposal;
  comparison: ReceiptComparison;
};
export type AutomationSettlement =
  | { kind: "verified"; version: VersionPayload; contact: ReceiptContactFields }
  | { kind: "unknown" | "rejected_no_write"; code: string };
export interface ReceiptAutomationDb {
  get(tenantId: string, requestId: string): Promise<AutomationRequestRow | null>;
  create(
    actor: ReceiptControlActor,
    record: AutomationCreateRecord,
    policy: ChangePolicy,
  ): Promise<AutomationRequestRow>;
  authorize(
    actor: ReceiptControlActor,
    id: string,
    expectedVersion: number,
    kind: "manual_approval" | "direct_policy" | "reject",
    policyRevision: string,
  ): Promise<AutomationRequestRow>;
  reserveDispatch(
    actor: ReceiptControlActor,
    id: string,
    expectedVersion: number,
    payloadHash: string,
    policyRevision: string,
  ): Promise<{ attempt: EditAttempt; dispatchGranted: boolean }>;
  hold(
    actor: ReceiptControlActor,
    id: string,
    expectedVersion: number,
    code: string,
  ): Promise<AutomationRequestRow>;
  settle(
    actor: ReceiptControlActor,
    id: string,
    attemptId: string,
    claimedVersion: number,
    expectedVersion: number,
    result: AutomationSettlement,
  ): Promise<AutomationRequestRow>;
}
const attempt = (r: any): EditAttempt => ({
  id: r.id,
  claimedVersion: r.claimed_version,
  payloadHash: r.payload_hash,
  phase: r.phase,
});
export function supabaseReceiptAutomationDb(): ReceiptAutomationDb {
  const map = async (r: any): Promise<AutomationRequestRow> => {
    const row = mapReceiptRequestRow(r),
      gen = r.generation ?? 1;
    if (gen === 2 && (!r.automation_meta || r.automation_meta.generation !== 2))
      throw new ReceiptControlError("receipt_control_store_failed");
    let a: EditAttempt | null = null;
    if (gen === 2) {
      const res = await (await changeAdmin())
        .from("hotel_receipt_edit_attempts")
        .select("id,claimed_version,payload_hash,phase")
        .eq("tenant_id", row.tenantId)
        .eq("request_id", row.id)
        .maybeSingle();
      if (res.error) throw changeDbError(res.error);
      if (res.data) a = attempt(res.data);
    }
    return { ...row, generation: gen, automation: r.automation_meta ?? null, attempt: a };
  };
  const rpc = async (actor: ReceiptControlActor, name: string, data: unknown) =>
    map(await changeRpc(actor, name, data));
  return {
    async get(tenant, id) {
      const r = await (await changeAdmin())
        .from("hotel_receipt_control_requests")
        .select("*")
        .eq("tenant_id", tenant)
        .eq("id", id)
        .maybeSingle();
      if (r.error) throw changeDbError(r.error);
      return r.data ? map(r.data) : null;
    },
    create: (actor, record, policy) =>
      rpc(actor, "hotelhub_receipt_control_v2_create", {
        ...record,
        policyRevision: policy.revision,
      }),
    authorize: (actor, requestId, expectedVersion, kind, policyRevision) =>
      rpc(actor, "hotelhub_receipt_control_v2_authorize", {
        requestId,
        expectedVersion,
        kind,
        policyRevision,
      }),
    async reserveDispatch(actor, requestId, expectedVersion, payloadHash, policyRevision) {
      const r = await changeRpc(actor, "hotelhub_receipt_control_v2_reserve", {
        requestId,
        expectedVersion,
        payloadHash,
        policyRevision,
      });
      return { attempt: attempt(r.attempt), dispatchGranted: r.dispatchGranted === true };
    },
    hold: (actor, requestId, expectedVersion, code) =>
      rpc(actor, "hotelhub_receipt_control_v2_hold", { requestId, expectedVersion, code }),
    settle: (actor, requestId, attemptId, claimedVersion, expectedVersion, result) =>
      rpc(actor, "hotelhub_receipt_control_v2_settle", {
        requestId,
        attemptId,
        claimedVersion,
        expectedVersion,
        result,
      }),
  };
}
