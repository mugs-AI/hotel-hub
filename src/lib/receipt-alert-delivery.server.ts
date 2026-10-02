// Receipt alert delivery. Transport is DISABLED: no provider, channel or
// recipient is configured, so claimed alerts are settled as "disabled" and
// nothing leaves the system. A future provider must be chosen by the Owner.
export type AlertTransport = {
  configured: false;
};

export type AlertOutboxRow = { id: string; tenantId: string; requestId: string; event: string };

export type AlertDeliveryDb = {
  claim(tenantId: string, limit: number): Promise<AlertOutboxRow[]>;
  settle(tenantId: string, alertId: string, status: "sent" | "failed" | "disabled", errorCode: string | null): Promise<void>;
};

export const RECEIPT_ALERT_TRANSPORT: AlertTransport = { configured: false };

/** Drain due alerts. With no transport configured every alert becomes "disabled". */
export async function deliverReceiptAlerts(
  tenantId: string,
  db: AlertDeliveryDb,
  transport: AlertTransport = RECEIPT_ALERT_TRANSPORT,
): Promise<{ claimed: number; sent: number; disabled: number }> {
  const rows = await db.claim(tenantId, 25);
  let disabled = 0;
  for (const row of rows) {
    if (!transport.configured) {
      await db.settle(tenantId, row.id, "disabled", "transport_not_configured");
      disabled++;
    }
  }
  return { claimed: rows.length, sent: 0, disabled };
}

export function supabaseAlertDeliveryDb(): AlertDeliveryDb {
  const sb = async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
    };
  };
  return {
    async claim(tenantId, limit) {
      const res = await (await sb()).rpc("hotelhub_receipt_alert_claim", { p_tenant_id: tenantId, p_limit: limit });
      if (res.error) throw new Error("receipt_alert_claim_failed");
      return (res.data ?? []).map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        requestId: r.request_id,
        event: r.event,
      }));
    },
    async settle(tenantId, alertId, status, errorCode) {
      const res = await (await sb()).rpc("hotelhub_receipt_alert_settle", {
        p_tenant_id: tenantId,
        p_alert_id: alertId,
        p_status: status,
        p_error_code: errorCode,
      });
      if (res.error) throw new Error("receipt_alert_settle_failed");
    },
  };
}
