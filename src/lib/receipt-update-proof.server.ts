import { createHash } from "node:crypto";
import {
  ReceiptControlError,
  MAX_RECEIPT_CONTROL_CENTS,
  assertReceiptControllable,
  type ReceiptSnapshot,
} from "./receipt-controls";
import { verifyReceiptControlResult } from "./receipt-controls-evidence.server";
import {
  buildReceiptUpdatePayload,
  type N3UpdateContract,
  type PreparedReceiptUpdate,
} from "./n3-receipt-update.server";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
import { isUuid } from "./reservations-store.server";
import { isSafeReferenceNo, type N3ExecutionLimit, type N3Outcome } from "./n3-receipts.server";
import { successfulEnvelope } from "./deposits-store.server";
import type { ProofSummary, ProofReport } from "./receipt-update-proof";
export type ProofPackage = {
  caseId: string;
  tenantKey: string;
  companyName: string;
  receiptId: string;
  docCode: string;
  documentDate: string;
  reference: string | null;
  customerId: string;
  customerCode: string;
  accountId: string;
  accountCode: string;
  beforeCents: number;
  afterCents: number;
  expiresAt: number;
  budgetMs: number;
  sourceRef: string;
};
export type ProofPermit = {
  id: string;
  tenantId: string;
  ownerKey: string;
  package: ProofPackage;
  packageHash: string;
  payloadHash: string;
  original: ReceiptSnapshot;
  expiresAt: number;
  phase: "prepared" | "reserved" | "unknown" | "verified";
  report: ProofReport | null;
};
export type ProofDb = {
  create(row: Omit<ProofPermit, "id" | "phase" | "report">): Promise<ProofPermit>;
  get(actor: ReceiptAutomationActor, id: string): Promise<ProofPermit | null>;
  claim(actor: ReceiptAutomationActor, id: string, payloadHash: string): Promise<boolean>;
  finish(
    actor: ReceiptAutomationActor,
    id: string,
    phase: "unknown" | "verified",
    report: ProofReport,
  ): Promise<void>;
};
export type ProofDeps = {
  enabled: boolean;
  packages: readonly ProofPackage[];
  contract: N3UpdateContract;
  now(): number;
  freshOwner(actor: ReceiptAutomationActor): Promise<void>;
  isHotelReceipt(receiptId: string): Promise<boolean>;
  read(
    actor: ReceiptAutomationActor,
    pkg: ProofPackage,
    limit: N3ExecutionLimit,
  ): Promise<{ snapshot: ReceiptSnapshot; raw: unknown }>;
  send(
    actor: ReceiptAutomationActor,
    prepared: PreparedReceiptUpdate,
    limit: N3ExecutionLimit,
  ): Promise<N3Outcome>;
  db: ProofDb;
};
export const proofPackageHash = (p: ProofPackage) =>
  createHash("sha256")
    .update(
      JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b)))),
    )
    .digest("hex");
const fail = (code: string): never => {
  throw new ReceiptControlError(code);
};
function owner(a: ReceiptAutomationActor) {
  if (a.role !== "owner" || !a.n3TenantKey) fail("forbidden");
}
function validPackage(p: ProofPackage) {
  if (
    ![p.receiptId, p.accountId].every(isUuid) ||
    !(
      isUuid(p.customerId) ||
      (/^[1-9]\d*$/.test(p.customerId) && Number(p.customerId) <= 2147483647)
    ) ||
    !p.companyName ||
    !p.caseId ||
    !p.customerCode ||
    !p.accountCode ||
    (p.reference !== null && !isSafeReferenceNo(p.reference)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(p.documentDate) ||
    !/^[a-f0-9]{40}$/.test(p.sourceRef) ||
    !Number.isSafeInteger(p.budgetMs) ||
    p.budgetMs <= 0 ||
    !Number.isSafeInteger(p.expiresAt) ||
    ![p.beforeCents, p.afterCents].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_RECEIPT_CONTROL_CENTS,
    ) ||
    p.beforeCents === p.afterCents ||
    p.docCode === "OR2610/001" ||
    p.reference?.includes("BK260920001")
  )
    fail("proof_invalid_package");
}
function summary(p: ProofPackage): ProofSummary {
  return {
    caseId: p.caseId,
    companyName: p.companyName,
    receiptId: p.receiptId,
    docCode: p.docCode,
    documentDate: p.documentDate,
    beforeCents: p.beforeCents,
    afterCents: p.afterCents,
    packageHash: proofPackageHash(p),
    sourceReference: p.sourceRef,
    expiresAt: p.expiresAt,
  };
}
function budget(ms: number, deps: ProofDeps, expiresAt = Infinity) {
  const controller = new AbortController(),
    deadlineAt = Math.min(deps.now() + ms, expiresAt);
  const limit = { signal: controller.signal, deadlineAt };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    const remaining = deadlineAt - deps.now();
    if (remaining <= 0 || controller.signal.aborted) return fail("execution_deadline");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ReceiptControlError("execution_deadline"));
          }, remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return { limit, run, close: () => controller.abort() };
}
function proposal(original: ReceiptSnapshot, pkg: ProofPackage) {
  return {
    kind: "correction" as const,
    amountCents: pkg.afterCents,
    accountId: pkg.accountId,
    contact: original.contact,
  };
}
function assertBefore(snapshot: ReceiptSnapshot, p: ProofPackage) {
  assertReceiptControllable(snapshot);
  if (
    snapshot.receiptId !== p.receiptId ||
    snapshot.docCode !== p.docCode ||
    snapshot.documentDate !== p.documentDate ||
    snapshot.customerId !== p.customerId ||
    snapshot.reference !== p.reference ||
    snapshot.currency !== "MYR" ||
    snapshot.amountCents !== p.beforeCents ||
    snapshot.paymentLines.length !== 1 ||
    snapshot.paymentLines[0]!.accountId !== p.accountId
  )
    fail("proof_before_mismatch");
}
export function receiptProofCases(actor: ReceiptAutomationActor, deps: ProofDeps) {
  owner(actor);
  return deps.enabled
    ? deps.packages
        .filter((p) => p.tenantKey === actor.n3TenantKey && p.expiresAt > deps.now())
        .map(summary)
    : [];
}
export async function prepareReceiptUpdateProof(
  actor: ReceiptAutomationActor,
  input: { caseId: string; receiptId: string; approvedPackageHash: string },
  deps: ProofDeps,
): Promise<{ permitId: string; summary: ProofSummary }> {
  owner(actor);
  if (!deps.enabled) return fail("proof_disabled");
  const p = deps.packages.find(
    (p) =>
      p.caseId === input.caseId &&
      p.receiptId === input.receiptId &&
      p.tenantKey === actor.n3TenantKey &&
      proofPackageHash(p) === input.approvedPackageHash,
  );
  if (!p || p.expiresAt <= deps.now()) return fail("proof_package_not_approved");
  validPackage(p);
  const b = budget(p.budgetMs, deps, p.expiresAt);
  try {
    await b.run(() => deps.freshOwner(actor));
    if (await b.run(() => deps.isHotelReceipt(p.receiptId))) return fail("proof_hotel_receipt");
    const { snapshot, raw } = await b.run(() => deps.read(actor, p, b.limit));
    assertBefore(snapshot, p);
    const prepared = buildReceiptUpdatePayload(raw, snapshot, proposal(snapshot, p), {
      ...deps.contract,
      allowNullReferenceForProof: p.reference === null,
    });
    const permit = await b.run(() =>
      deps.db.create({
        tenantId: actor.tenantId,
        ownerKey: actor.n3UserKey,
        package: p,
        packageHash: proofPackageHash(p),
        payloadHash: prepared.payloadHash,
        original: snapshot,
        expiresAt: p.expiresAt,
      }),
    );
    return { permitId: permit.id, summary: summary(p) };
  } finally {
    b.close();
  }
}
async function get(actor: ReceiptAutomationActor, id: string, deps: ProofDeps) {
  owner(actor);
  if (!isUuid(id)) return fail("invalid_id");
  const p = await deps.db.get(actor, id);
  if (
    !p ||
    p.tenantId !== actor.tenantId ||
    p.ownerKey !== actor.n3UserKey ||
    p.package.tenantKey !== actor.n3TenantKey
  )
    return fail("proof_permit_not_found");
  validPackage(p.package);
  return p;
}
function result(p: ProofPermit) {
  return { outcome: p.phase === "verified" ? "verified" : "needs_review", safeReport: p.report };
}
async function finish(
  actor: ReceiptAutomationActor,
  permit: ProofPermit,
  deps: ProofDeps,
  verified: boolean,
  started: number,
) {
  const report: ProofReport = {
    ...summary(permit.package),
    outcome: verified ? "verified" : "needs_review",
    journalVerified: verified,
    conditionalWrite: "not_proven",
    reservationCount: 1,
    durationMs: Math.max(0, deps.now() - started),
  };
  // A local persistence failure leaves the reserved permit held; no financial resend.
  await deps.db.finish(actor, permit.id, verified ? "verified" : "unknown", report);
  return { outcome: report.outcome, safeReport: report };
}
export async function runReceiptUpdateProof(
  actor: ReceiptAutomationActor,
  id: string,
  deps: ProofDeps,
) {
  const permit = await get(actor, id, deps);
  if (permit.phase !== "prepared") return result(permit);
  if (!deps.enabled) return fail("proof_disabled");
  const pkg = deps.packages.find((p) => proofPackageHash(p) === permit.packageHash);
  if (!pkg || pkg.expiresAt <= deps.now() || permit.expiresAt <= deps.now())
    return fail("proof_package_not_approved");
  const b = budget(pkg.budgetMs, deps, Math.min(pkg.expiresAt, permit.expiresAt)),
    started = deps.now();
  let claimed = false;
  try {
    await b.run(() => deps.freshOwner(actor));
    if (await b.run(() => deps.isHotelReceipt(pkg.receiptId))) return fail("proof_hotel_receipt");
    const { snapshot, raw } = await b.run(() => deps.read(actor, pkg, b.limit));
    assertBefore(snapshot, pkg);
    if (snapshot.sourceFingerprint !== permit.original.sourceFingerprint)
      return fail("n3_changed_since_request");
    const prepared = buildReceiptUpdatePayload(raw, snapshot, proposal(permit.original, pkg), {
      ...deps.contract,
      allowNullReferenceForProof: pkg.reference === null,
    });
    if (prepared.payloadHash !== permit.payloadHash) return fail("proof_payload_changed");
    claimed = await b.run(() => deps.db.claim(actor, id, prepared.payloadHash));
    if (!claimed) return result((await deps.db.get(actor, id)) ?? permit);
    await b.run(() => deps.freshOwner(actor));
    if (!deps.enabled) return fail("proof_disabled");
    const out = await b.run(() => deps.send(actor, prepared, b.limit));
    if (
      out.kind !== "response" ||
      out.status < 200 ||
      out.status >= 300 ||
      !successfulEnvelope(out.body)
    )
      return await finish(actor, permit, deps, false, started);
    const readback = await b.run(() => deps.read(actor, pkg, b.limit));
    await b.run(() => deps.freshOwner(actor));
    return await finish(
      actor,
      permit,
      deps,
      verifyReceiptControlResult(
        permit.original,
        proposal(permit.original, pkg),
        readback.snapshot,
      ) === "verified",
      started,
    );
  } catch (e) {
    if (!claimed) throw e;
    return await finish(actor, permit, deps, false, started);
  } finally {
    b.close();
  }
}
export async function checkReceiptUpdateProof(
  actor: ReceiptAutomationActor,
  id: string,
  deps: ProofDeps,
) {
  const p = await get(actor, id, deps);
  if (p.phase === "prepared")
    return {
      outcome: "not_dispatched",
      phase: p.phase,
      summary: summary(p.package),
      safeReport: null,
    };
  if (p.phase === "verified") return result(p);
  const b = budget(p.package.budgetMs, deps),
    started = deps.now();
  try {
    await b.run(() => deps.freshOwner(actor));
    const evidence = await b.run(() => deps.read(actor, p.package, b.limit));
    await b.run(() => deps.freshOwner(actor));
    return await finish(
      actor,
      p,
      deps,
      verifyReceiptControlResult(p.original, proposal(p.original, p.package), evidence.snapshot) ===
        "verified",
      started,
    );
  } catch {
    return await finish(actor, p, deps, false, started);
  } finally {
    b.close();
  }
}

export async function readReceiptUpdateProofPermit(
  actor: ReceiptAutomationActor,
  id: string,
  deps: ProofDeps,
) {
  const p = await get(actor, id, deps);
  await deps.freshOwner(actor);
  return { permitId: p.id, phase: p.phase, summary: summary(p.package), safeReport: p.report };
}
