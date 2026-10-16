import { z } from "zod";
const revision = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const attributionAssignmentSchema = z
  .object({ lineId: z.string().uuid(), leg: z.enum(["source_room", "guest"]) })
  .strict();
export const attributionSaveSchema = z
  .object({
    expectedRevision: revision,
    basisDigest: z.string().regex(/^[a-f0-9]{64}$/),
    assignments: z.array(attributionAssignmentSchema).min(1).max(10000),
  })
  .strict();
export type AttributionSave = z.infer<typeof attributionSaveSchema>;
export const attributionViewSchema = z.object({
  tenantId: z.string().uuid(),
  reservationId: z.string().uuid(),
  revision,
  basisDigest: z.string().regex(/^[a-f0-9]{64}$/),
  frozen: z.boolean(),
  stale: z.boolean(),
  collectionMode: z.enum(["guest", "source"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  guestCustomerId: z.number().int().positive(),
  sourceCustomerId: z.number().int().positive().nullable(),
  rows: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        kind: z.string().max(40),
        description: z.string().min(1).max(160),
        totalCents: z.number().int().min(0).max(1000000000),
        leg: z.enum(["source_room", "guest"]).nullable(),
      }),
    )
    .max(10000),
  blockers: z.array(z.string().max(120)).max(10),
});
export type AttributionView = z.infer<typeof attributionViewSchema>;
export function parseAttributionView(
  raw: unknown,
  tenantId: string,
  reservationId: string,
): AttributionView {
  const v = attributionViewSchema.parse(raw);
  if (
    v.tenantId !== tenantId ||
    v.reservationId !== reservationId ||
    new Set(v.rows.map((r) => r.lineId.toLowerCase())).size !== v.rows.length
  )
    throw Error("source_attribution_scope_mismatch");
  return v;
}
export function attributionMessage(code: string) {
  if (code === "source_attribution_frozen_unverified")
    return "A verified frozen allocation is unavailable for this stay. Refer Admin.";
  if (/changed|conflict|stale/.test(code))
    return "Charges, payer or allocation changed. Reload and review before saving.";
  if (/frozen|settlement_locked/.test(code))
    return "Billing is frozen. Charge allocation can no longer be changed.";
  if (/payer_required/.test(code)) return "Ask the Owner to confirm billing collection first.";
  if (/attribution_invalid|attribution_required/.test(code))
    return "Assign every charge to one bill before saving.";
  if (/forbidden|owner_required/.test(code)) return "Only the Owner can change charge allocation.";
  if (/session|unauthorized|unauthenticated/.test(code))
    return "Your session changed. Reopen this booking.";
  return "Prepare and verify the folio and billing setup first. Refer Admin.";
}
