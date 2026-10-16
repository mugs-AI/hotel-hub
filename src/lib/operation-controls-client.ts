import { useQuery } from "@tanstack/react-query";
import { useSessionMe } from "./session-client";
import type { OperationControls } from "./operation-controls";
export function useOperationControls(enabled = true) {
  const session = useSessionMe().data;
  const identity =
    session?.authenticated && session.tenant?.tenantId && session.user?.n3UserKey && session.role
      ? `${session.tenant.tenantId}:${session.user.n3UserKey}:${session.role}`
      : null;
  return useQuery({
    queryKey: ["operation-controls", identity],
    enabled: enabled && identity !== null,
    staleTime: 10000,
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
    queryFn: () => operationControlsJson(),
    retry: false,
  });
}
async function operationControlsJson(body?: {
  rateChangeEnabled: boolean;
  expectedRevision: string;
}): Promise<OperationControls> {
  const response = await fetch("/api/hotel/operation-controls", {
    credentials: "same-origin",
    ...(body
      ? {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "operation_controls_unavailable");
  return data.controls;
}
export const saveOperationControls = (body: {
  rateChangeEnabled: boolean;
  expectedRevision: string;
}) => operationControlsJson(body);
