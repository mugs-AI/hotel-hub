import type { HotelRole } from "./rbac";
import {
  SecurityCashError,
  parseSecurityCommand,
  parseSecurityPolicy,
  parseSecurityStatement,
  securityUuid,
  validSecurityDate,
  type SecurityBooking,
  type SecurityHolding,
  type SecurityOverview,
  type SecurityStatement,
  type SecurityReport,
} from "./security-cash";
export type SecurityActor = { tenantId: string; userKey: string; role: HotelRole };
type Result = { data: unknown; error: { message?: string; code?: string } | null };
async function call(
  actor: SecurityActor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!securityUuid(actor.tenantId) || !actor.userKey?.trim())
    throw new SecurityCashError("forbidden");
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r: Result = await (
      supabaseAdmin as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<Result>;
      }
    ).rpc(name, { p_tenant: actor.tenantId, ...args });
    if (r.error) {
      const code = r.error.message?.match(
        /\b(security_[a-z_]+|reservation_not_found|forbidden)\b/,
      )?.[1];
      throw new SecurityCashError(code ?? "security_unavailable");
    }
    if (r.data === null || r.data === undefined)
      throw new SecurityCashError("security_unavailable");
    return r.data;
  } catch (e) {
    if (e instanceof SecurityCashError) throw e;
    throw new SecurityCashError("security_unavailable");
  }
}
export async function readSecurityCash(
  actor: SecurityActor,
  reservationId: string,
): Promise<SecurityBooking> {
  if (!["owner", "front_desk"].includes(actor.role)) throw new SecurityCashError("forbidden");
  if (!securityUuid(reservationId)) throw new SecurityCashError("security_invalid_request");
  const data = (await call(actor, "hh_security_read", {
    p_reservation: reservationId,
  })) as SecurityBooking;
  if (!data || data.available !== true || !Array.isArray(data.holdings) || !data.policy)
    throw new SecurityCashError("security_unavailable");
  return data;
}
export async function writeSecurityCash(
  actor: SecurityActor,
  reservationId: string,
  key: string,
  value: unknown,
): Promise<SecurityHolding | { inspectionRecorded: true }> {
  const body = parseSecurityCommand(value);
  if (!securityUuid(reservationId) || !securityUuid(key))
    throw new SecurityCashError("security_invalid_request");
  if (actor.role === "housekeeper" && body.action !== "inspect")
    throw new SecurityCashError("forbidden");
  if (
    !["collect", "inspect", "reserve_return", "confirm_return"].includes(String(body.action)) &&
    actor.role !== "owner"
  )
    throw new SecurityCashError("forbidden");
  return (await call(actor, "hh_security_command", {
    p_reservation: reservationId,
    p_actor: actor.userKey,
    p_role: actor.role,
    p_key: key,
    p_body: body,
  })) as SecurityHolding;
}
export async function readSecurityReport(
  actor: SecurityActor,
  from: string,
  asAt: string,
  shift = false,
): Promise<SecurityOverview> {
  if (actor.role !== "owner" && !(shift && actor.role === "front_desk"))
    throw new SecurityCashError("forbidden");
  if (!validSecurityDate(from) || !validSecurityDate(asAt) || Date.parse(from) > Date.parse(asAt))
    throw new SecurityCashError("security_invalid_report");
  const data = (await call(actor, "hh_security_overview", {
    p_from: from,
    p_as_at: asAt,
  })) as SecurityOverview;
  if (!data?.report || !Array.isArray(data.report.holdings) || !Array.isArray(data.statements))
    throw new SecurityCashError("security_unavailable");
  if (actor.role === "front_desk") {
    data.report = staffReport(data.report);
    data.statements = data.statements.map((s) => staffStatement(s));
  }
  return data;
}
function staffReport(report: SecurityReport): SecurityReport {
  return {
    ...report,
    events: [],
    holdings: report.holdings.map((h) => ({ ...h, payer: "", recipient: "", terms: "" })),
  };
}
function staffStatement(statement: SecurityStatement): SecurityStatement {
  return { ...statement, snapshot: staffReport(statement.snapshot) };
}
export async function writeSecurityStatement(
  actor: SecurityActor,
  key: string,
  value: unknown,
): Promise<SecurityStatement> {
  if (!["owner", "front_desk"].includes(actor.role)) throw new SecurityCashError("forbidden");
  if (!securityUuid(key)) throw new SecurityCashError("security_invalid_request");
  const result = (await call(actor, "hh_security_statement", {
    p_actor: actor.userKey,
    p_role: actor.role,
    p_key: key,
    p_body: parseSecurityStatement(value),
  })) as SecurityStatement;
  return actor.role === "front_desk" ? staffStatement(result) : result;
}
export async function updateSecurityPolicy(actor: SecurityActor, value: unknown) {
  if (actor.role !== "owner") throw new SecurityCashError("forbidden");
  const p = parseSecurityPolicy(value);
  return await call(actor, "hh_security_policy", {
    p_actor: actor.userKey,
    p_expected: p.version,
    p_amount: p.amountCents,
    p_required: p.required,
    p_terms: p.terms,
  });
}
export async function readSecurityInspection(actor: SecurityActor, reservationId: string) {
  if (!securityUuid(reservationId)) throw new SecurityCashError("security_invalid_request");
  const data = (await call(actor, "hh_security_inspection_read", {
    p_reservation: reservationId,
  })) as { holdings: unknown[] };
  if (!Array.isArray(data?.holdings)) throw new SecurityCashError("security_unavailable");
  return data;
}
