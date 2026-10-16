import { z } from "zod";
import { sourcePolicySchema } from "./source-policy-view";
export const initialPayerSchema = z
  .object({
    sourceId: z.string().uuid(),
    policyVersion: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n),
    collectionMode: z.enum(["guest", "source"]),
  })
  .strict();
export type InitialBookingPayer = z.infer<typeof initialPayerSchema>;
export const initialPolicyViewSchema = z.discriminatedUnion("required", [
  z.object({
    tenantId: z.string().uuid(),
    sourceCode: z.string(),
    required: z.literal(false),
    policy: z.null(),
  }),
  z.object({
    tenantId: z.string().uuid(),
    sourceCode: z.string(),
    required: z.literal(true),
    policy: sourcePolicySchema,
  }),
]);
export type InitialPolicyView = z.infer<typeof initialPolicyViewSchema>;
export function parseInitialPolicyView(
  raw: unknown,
  tenantId: string,
  sourceCode: string,
): InitialPolicyView {
  const v = initialPolicyViewSchema.parse(raw);
  if (
    v.tenantId !== tenantId ||
    v.sourceCode !== sourceCode ||
    (v.required && v.policy.version === "0")
  )
    throw Error("source_policy_scope_mismatch");
  return v;
}
