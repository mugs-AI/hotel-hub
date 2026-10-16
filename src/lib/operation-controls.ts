export type OperationControls = {
  tenantId: string;
  rateChangeEnabled: boolean;
  revision: string | null;
  available: boolean;
};
export class OperationControlsError extends Error {
  constructor(
    readonly code:
      | "operation_controls_unavailable"
      | "operation_controls_stale"
      | "forbidden"
      | "invalid_request",
  ) {
    super(code);
  }
}
