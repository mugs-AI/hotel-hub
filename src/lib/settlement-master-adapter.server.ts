// Observed detail-shape projections only. No I/O, snapshot approval or posting gate.
// Local MYR currency and CustomerStatus shapes were reviewed 15/10/2026.
// These projections alone never establish live provenance or posting authority.
import type { EvidenceResult } from "./settlement";
import type { MasterKind } from "./n3-settlement-master-diagnostics.server";
import { isN3Guid } from "./n3-guid";
class MasterError extends Error {
  constructor(
    public kind: "unavailable" | "contradiction",
    code: string,
  ) {
    super(code);
  }
}
const missing = () => {
  throw new MasterError("unavailable", "master_fields_unproven");
};
const mismatch = () => {
  throw new MasterError("contradiction", "master_relationship_mismatch");
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return missing();
  const keys = Object.keys(value);
  if (new Set(keys.map((k) => k.toLowerCase())).size !== keys.length) return mismatch();
  return value as Record<string, unknown>;
}
function numericId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    return missing();
  return value;
}
function guid(value: unknown): string {
  if (!isN3Guid(value)) return missing();
  return (value as string).toLowerCase();
}
function code(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._ /%-]{0,99}$/i.test(value)) return missing();
  return value;
}
function active(value: unknown): true {
  if (value === false) throw new MasterError("contradiction", "master_inactive");
  if (value !== true) return missing();
  return true;
}
function currencyObservation(value: unknown): Record<string, unknown> {
  const c = object(value),
    result: Record<string, unknown> = { id: numericId(c.id), code: code(c.code) };
  if (!/^[A-Z]{3}$/.test(String(result.code))) return missing();
  if (c.local !== undefined) {
    if (typeof c.local !== "boolean") return missing();
    result.local = c.local;
  }
  for (const [input, output] of [
    ["defaultSalesRate", "salesRate"],
    ["defaultPurchaseRate", "purchaseRate"],
  ]) {
    if (c[input] !== undefined) {
      if (typeof c[input] !== "number" || !Number.isFinite(c[input]) || Number(c[input]) <= 0)
        return missing();
      result[output] = c[input];
    }
  }
  return result;
}
function account(value: unknown): {
  id: string;
  code: string;
  active: true;
  currency?: Record<string, unknown>;
  typeCode?: string;
  typeId?: string;
} {
  const a = object(value);
  const result: ReturnType<typeof account> = {
    id: guid(a.id),
    code: code(a.code),
    active: active(a.isActive),
  };
  if (a.currency !== undefined) result.currency = currencyObservation(a.currency);
  if (a.currencyId !== undefined) {
    if (!result.currency) return missing();
    if (numericId(a.currencyId) !== result.currency.id) return mismatch();
  }
  if (a.type !== undefined) result.typeCode = code(a.type);
  if (a.accountType !== undefined) {
    const t = object(a.accountType),
      typeCode = code(t.typeCode);
    result.typeId = guid(t.id);
    if (
      (result.typeCode !== undefined && result.typeCode !== typeCode) ||
      (t.code !== undefined && t.code !== typeCode)
    )
      return mismatch();
    result.typeCode = typeCode;
  }
  if (a.accountTypeId !== undefined) {
    if (!result.typeId) return missing();
    if (guid(a.accountTypeId) !== result.typeId) return mismatch();
  }
  return result;
}
/** Exact observed customer contact keys. Unsupported shapes remain unavailable
 * for document preparation without blocking unrelated accounting observations. */
function customerBillTo(d: Record<string, unknown>) {
  const text = (v: unknown, max: number) =>
    v === null || v === undefined ? "" : typeof v === "string" && v.length <= max ? v : null;
  const name = text(d.name, 160),
    phone = text(d.phoneNo1, 60);
  const parts = [d.address1, d.address2, d.address3, d.address4].map((v) => text(v, 600));
  if (
    !name?.trim() ||
    phone === null ||
    parts.some((v) => v === null) ||
    !Array.isArray(d.emailList) ||
    d.emailList.length > 1
  )
    return null;
  const address = parts.filter(Boolean).join("\n");
  const email = d.emailList.length ? text(d.emailList[0], 254) : "";
  if (
    address.length > 600 ||
    email === null ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    return null;
  return { name, company: "", address, phone, email };
}
function uom(value: unknown) {
  const u = object(value);
  if (typeof u.rate !== "number" || !Number.isFinite(u.rate) || u.rate <= 0 || u.rate > 999999)
    return missing();
  return {
    id: numericId(u.id),
    stockId: numericId(u.stockId),
    code: code(u.code),
    active: active(u.isActive),
    rate: u.rate,
  };
}
export function parseObservedSettlementMaster(
  kind: MasterKind,
  requestedId: number | string,
  raw: unknown,
): EvidenceResult<Record<string, unknown>> {
  try {
    const envelope = object(raw);
    if (envelope.code !== "0000") return missing();
    const d = object(envelope.data);
    const id = kind === "account" ? guid(d.id) : numericId(d.id);
    const expected = kind === "account" ? guid(requestedId) : numericId(requestedId);
    if (id !== expected) return { kind: "contradiction", code: "master_identity_mismatch" };
    const common = { kind, id, code: code(d.code), postingAuthority: false as const };
    if (kind === "currency") {
      // Only the supplied local-MYR contract is supported. No foreign rates or
      // missing/default fields are silently inferred from currency names.
      if (
        d.code !== "MYR" ||
        d.local !== true ||
        d.defaultSalesRate !== 1 ||
        d.defaultPurchaseRate !== 1
      )
        return { kind: "unavailable", code: "master_currency_unsupported" };
      return {
        kind: "confirmed",
        value: { ...common, local: true, salesRate: 1, purchaseRate: 1 },
      };
    }
    if (kind === "stock") {
      const isActive = active(d.isActive);
      const preset = object(d.accountPreset);
      const presetId = numericId(preset.id);
      if (numericId(d.accountPresetId) !== presetId) return mismatch();
      const revenue = account(preset.cashSalesAccount);
      if (!Array.isArray(d.uoms) || !d.uoms.length || d.uoms.length > 100) return missing();
      const units = d.uoms.map(uom);
      if (
        new Set(units.map((u) => u.id)).size !== units.length ||
        units.some((u) => u.stockId !== id)
      )
        return mismatch();
      return {
        kind: "confirmed",
        value: {
          ...common,
          active: isActive,
          accountPresetId: presetId,
          revenueAccountId: revenue.id,
          revenueAccountCode: revenue.code,
          revenueAccount: revenue,
          uoms: units,
        },
      };
    }
    if (kind === "uom") return { kind: "confirmed", value: { ...common, ...uom(d) } };
    if (kind === "customer") {
      // The integer is retained as an observation; it is NOT interpreted as active.
      if (
        typeof d.status !== "number" ||
        !Number.isInteger(d.status) ||
        d.status < 0 ||
        d.status > 255
      )
        return missing();
      const currencyId = numericId(d.currencyId),
        currency = object(d.currency);
      const currencyCode = code(currency.code);
      if (!/^[A-Z]{3}$/.test(currencyCode)) return missing();
      if (
        numericId(currency.id) !== currencyId ||
        (d.currencyCode !== undefined && d.currencyCode !== currencyCode)
      )
        return mismatch();
      const control = account(d.controlAccount);
      if (guid(d.controlAccountId) !== control.id) return mismatch();
      return {
        kind: "confirmed",
        value: {
          ...common,
          status: d.status,
          billTo: customerBillTo(d),
          currencyId,
          currencyCode,
          currencyObservation: currencyObservation(currency),
          controlAccountId: control.id,
          controlAccountCode: control.code,
          controlAccount: control,
        },
      };
    }
    if (kind === "tax") {
      if (typeof d.rate !== "number" || !Number.isFinite(d.rate) || d.rate < 0 || d.rate > 1)
        return missing();
      const isActive = active(d.isActive);
      if (d.isOutputTax !== true) return missing();
      const posting = account(d.postingAccount);
      if (guid(d.postingAccountId) !== posting.id) return mismatch();
      return {
        kind: "confirmed",
        value: {
          ...common,
          active: isActive,
          output: true,
          rate: d.rate,
          postingAccountId: posting.id,
          postingAccountCode: posting.code,
          postingAccount: posting,
        },
      };
    }
    if (kind !== "account") return missing();
    const a = account(d),
      type = object(d.accountType);
    const typeId = guid(d.accountTypeId);
    if (guid(type.id) !== typeId) return mismatch();
    const currencyId = numericId(d.currencyId);
    const currency = object(d.currency),
      currencyCode = code(currency.code);
    if (!/^[A-Z]{3}$/.test(currencyCode)) return missing();
    if (
      numericId(currency.id) !== currencyId ||
      (type.code !== undefined && type.code !== type.typeCode)
    )
      return mismatch();
    return {
      kind: "confirmed",
      value: {
        ...common,
        active: a.active,
        currencyId,
        currencyCode,
        accountTypeId: typeId,
        typeCode: code(type.typeCode),
        accountObservation: a,
      },
    };
  } catch (error) {
    return error instanceof MasterError
      ? { kind: error.kind, code: error.message }
      : { kind: "unavailable", code: "master_fields_unproven" };
  }
}
export function verifyObservedStockUom(
  stock: unknown,
  unit: unknown,
  stockId: number,
  uomId: number,
): EvidenceResult<Record<string, unknown>> {
  const s = parseObservedSettlementMaster("stock", stockId, stock);
  if (s.kind !== "confirmed") return s;
  const u = parseObservedSettlementMaster("uom", uomId, unit);
  if (u.kind !== "confirmed") return u;
  const member = (s.value.uoms as Array<Record<string, unknown>>).find((row) => row.id === uomId);
  if (
    !member ||
    u.value.stockId !== stockId ||
    member.stockId !== stockId ||
    member.code !== u.value.code ||
    member.rate !== u.value.rate
  )
    return { kind: "contradiction", code: "master_relationship_mismatch" };
  return { kind: "confirmed", value: { stock: s.value, uom: u.value, postingAuthority: false } };
}

/** N3 CustomerStatus, not supplier status. QNE's N3 customer import reference
 * and sales-v1 CustomerStatus schema both define 0 ACTIVE, 1 INACTIVE,
 * 2 PROSPECT, 3 SUSPENDED. Unknown values never imply permission to post.
 * https://support.qne.com.my/support/solutions/articles/81000416325
 */
export function verifySettlementCustomerActivity(status: unknown): EvidenceResult<true> {
  if (status === 0) return { kind: "confirmed", value: true };
  if (status === 1 || status === 2 || status === 3)
    return { kind: "contradiction", code: "master_customer_not_active" };
  return { kind: "unavailable", code: "master_customer_status_unproven" };
}
