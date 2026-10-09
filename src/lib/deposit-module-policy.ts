// Browser-safe policy only. Readiness and N3 financial permissions are separate.
export type DepositModulePolicy = {
  roomAdvanceEnabled: boolean;
  securityDepositEnabled: boolean;
  version: string;
};
export type DepositModulePolicyState = {
  policy: DepositModulePolicy;
  available: boolean;
  securityReady: boolean;
};
export class DepositModulePolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DepositModulePolicyError";
  }
}
export function legacyDepositModulePolicy(): DepositModulePolicy {
  return { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0" };
}
export function parseDepositModulePolicy(value: unknown): DepositModulePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DepositModulePolicyError("invalid_deposit_module_policy");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !["roomAdvanceEnabled", "securityDepositEnabled", "version"].includes(key),
    ) ||
    typeof row.roomAdvanceEnabled !== "boolean" ||
    typeof row.securityDepositEnabled !== "boolean" ||
    typeof row.version !== "string" ||
    !/^(0|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(row.version)
  )
    throw new DepositModulePolicyError("invalid_deposit_module_policy");
  return {
    roomAdvanceEnabled: row.roomAdvanceEnabled,
    securityDepositEnabled: row.securityDepositEnabled,
    version: row.version.toLowerCase(),
  };
}
export function depositModuleCapabilities(
  policy: DepositModulePolicy,
  readiness: { advance: boolean; security: boolean },
): { advance: boolean; security: boolean } {
  return {
    advance: policy.roomAdvanceEnabled && readiness.advance,
    security: policy.securityDepositEnabled && readiness.security,
  };
}
