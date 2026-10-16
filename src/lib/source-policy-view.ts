// Browser-safe allowlists shared with the fixed HTTP boundary.
import { z } from "zod";
const uuid = z.string().uuid(),
  revision = z
    .string()
    .regex(/^(0|[1-9]\d{0,18})$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n);
const mode = z.enum(["guest", "source"]),
  master = z.number().int().positive().max(2147483647);
export const sourcePolicySchema = z
  .object({
    sourceId: uuid,
    version: revision,
    defaultCollectionMode: mode,
    allowedCollectionModes: z.array(mode).min(1).max(2),
    sourceCustomerId: master.nullable(),
    guestCustomerId: master,
    guestDocumentTitle: z.string().min(1).max(160),
    guestItemDescription: z.string().min(1).max(600),
    showRoomPrices: z.boolean(),
  })
  .refine(
    (p) =>
      new Set(p.allowedCollectionModes).size === p.allowedCollectionModes.length &&
      p.allowedCollectionModes.includes(p.defaultCollectionMode) &&
      (!p.allowedCollectionModes.includes("source") ||
        (p.sourceCustomerId !== null && p.sourceCustomerId !== p.guestCustomerId)),
  );
const savedPayer = z
  .object({
    policy: sourcePolicySchema,
    collectionMode: mode,
    confirmedBy: z.string().min(1).max(320),
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .refine((p) => p.policy.allowedCollectionModes.includes(p.collectionMode));
const policyView = z
  .object({
    tenantId: uuid,
    sourceId: uuid,
    policy: sourcePolicySchema,
    blockers: z
      .array(z.string().regex(/^[a-z0-9_]{1,120}$/))
      .max(20)
      .default([]),
  })
  .refine((v) => v.policy.sourceId === v.sourceId);
const payerView = z
  .object({
    tenantId: uuid,
    reservationId: uuid,
    sourceId: uuid,
    revision,
    updatedAt: z.string().datetime({ offset: true }),
    frozen: z.boolean(),
    payer: savedPayer.nullable(),
    policy: sourcePolicySchema.nullable(),
    blockers: z.array(z.string().regex(/^[a-z0-9_]{1,120}$/)).max(20),
  })
  .refine(
    (v) =>
      (!v.payer || v.payer.policy.sourceId === v.sourceId) &&
      (!v.policy || v.policy.sourceId === v.sourceId),
  );
export type SourcePolicyView = z.infer<typeof policyView>;
export type ReservationPayerView = z.infer<typeof payerView>;
export function parsePolicyView(
  value: unknown,
  tenantId: string,
  sourceId: string,
): SourcePolicyView | null {
  const p = policyView.safeParse(value);
  return p.success && p.data.tenantId === tenantId && p.data.sourceId === sourceId ? p.data : null;
}
export function parsePayerView(
  value: unknown,
  tenantId: string,
  reservationId: string,
): ReservationPayerView | null {
  const p = payerView.safeParse(value);
  return p.success && p.data.tenantId === tenantId && p.data.reservationId === reservationId
    ? p.data
    : null;
}
