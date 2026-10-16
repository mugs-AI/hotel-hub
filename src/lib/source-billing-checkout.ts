import { z } from "zod";
import { MAX_MONEY_CENTS } from "./checkout-money";
import { isN3Guid } from "./n3-guid";
const localId = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
const n3Id = z.string().refine(isN3Guid);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const cents = z.number().int().min(0).max(MAX_MONEY_CENTS);
const currency = z.string().regex(/^[A-Z]{3}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const codes = z.array(z.string().regex(/^[a-z0-9_]{1,120}$/)).max(100);
const settlementView = z.object({
  tenantId: localId,
  reservationId: localId,
  intentId: localId.nullable(),
  snapshotDigest: digest.nullable(),
  revision,
  state: z
    .enum([
      "frozen",
      "bill_dispatched",
      "bill_verified",
      "allocating",
      "awaiting_payment",
      "balance_dispatched",
      "settled",
      "closing",
      "closed",
      "needs_review",
      "abandoned",
    ])
    .nullable(),
  currency,
  bill: z
    .object({
      id: n3Id,
      code: z.string().min(1).max(100),
      documentDate: date,
      totalCents: cents,
      outstandingCents: cents,
    })
    .nullable(),
  receipts: z
    .array(
      z.object({
        id: n3Id,
        code: z.string().min(1).max(100),
        documentDate: date,
        amountCents: cents,
        allocatedCents: cents,
        remainderCents: cents,
      }),
    )
    .max(11),
  blockers: codes,
  allowedActions: z
    .array(z.enum(["post_bill", "apply_deposits", "receive_balance", "apply_balance"]))
    .max(4),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  canSplitPayment: z.boolean().optional(),
});
const kind = z.enum(["source_room", "guest"]);
const schema = z.object({
  tenantId: localId,
  reservationId: localId,
  legacy: z.boolean(),
  review: z
    .object({
      folioRevision: revision,
      planDigest: digest,
      currency,
      totalCents: cents,
      canConfirm: z.boolean(),
      legs: z
        .array(
          z.object({
            legId: localId,
            kind,
            customerId: z.number().int().positive(),
            totalCents: cents,
          }),
        )
        .min(1)
        .max(2),
    })
    .nullable(),
  stay: z
    .object({
      reservationId: localId,
      revision,
      planDigest: digest,
      canClose: z.literal(false),
      blockers: codes,
      legs: z
        .array(
          z.object({
            legId: localId,
            kind,
            hhNumber: z.string().regex(/^SI\d{9}$/),
            view: settlementView,
          }),
        )
        .min(1)
        .max(2),
    })
    .nullable(),
  blockers: codes,
});
export type SourceCheckoutView = z.infer<typeof schema>;
export type SourceLegBinding = { legId: string; planDigest: string };
/** Allowlist both directions. Extra server fields are stripped, never spread. */
export function parseSourceCheckoutView(
  raw: unknown,
  tenantId: string,
  reservationId: string,
): SourceCheckoutView | null {
  const result = schema.safeParse(raw);
  if (!result.success) return null;
  const v = result.data;
  if (
    v.tenantId !== tenantId ||
    v.reservationId !== reservationId ||
    (v.legacy && (v.review || v.stay)) ||
    (v.review && v.stay)
  )
    return null;
  const legs = v.review?.legs ?? v.stay?.legs;
  if (
    legs &&
    (new Set(legs.map((l) => l.legId)).size !== legs.length ||
      new Set(legs.map((l) => l.kind)).size !== legs.length)
  )
    return null;
  if (
    v.review &&
    (v.review.legs.reduce((n, l) => n + l.totalCents, 0) !== v.review.totalCents ||
      (v.blockers.length && v.review.canConfirm))
  )
    return null;
  if (
    v.stay &&
    (v.stay.reservationId !== reservationId ||
      v.stay.legs.some(
        (l) =>
          l.view.tenantId !== tenantId ||
          l.view.reservationId !== reservationId ||
          l.view.intentId !== l.legId ||
          (l.kind === "source_room" && l.view.allowedActions.some((a) => a !== "post_bill")),
      ))
  )
    return null;
  return v;
}
