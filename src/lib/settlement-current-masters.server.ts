// Current own-session GET observations, never a posting/knock-off activation gate.
import type { SettlementActor } from "./settlement-context.server";
import type { BillToSnapshot, ChargeLine, EvidenceResult } from "./settlement";
import type { SnapshotDeps } from "./settlement-snapshot.server";
import type { MasterKind } from "./n3-settlement-master-diagnostics.server";
import {
  readSettlementMaster,
  billingMasterBoundTo,
  billingPayloadDigest,
  type BillingReadLimit,
} from "./n3-billing.server";
import {
  parseObservedSettlementMaster,
  verifySettlementCustomerActivity,
} from "./settlement-master-adapter.server";
import { MAX_MONEY_CENTS } from "./checkout-money";
import { hasPermission } from "./rbac";

type Header = { customerId: number; currencyId: number; currency: string; currencyRate: number };
type Observation = { fields: Record<string, unknown>; fingerprint: string };
const unavailable = (code: string) => ({ kind: "unavailable" as const, code });
const contradiction = (code: string) => ({ kind: "contradiction" as const, code });
const localId = (s: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
function validActor(a: SettlementActor) {
  return (
    hasPermission(a.role, "hotel:checkout:view") &&
    localId(a.tenantId) &&
    (localId(a.reservationId) || (a.reservationId === "" && a.role === "owner")) &&
    typeof a.n3UserKey === "string" &&
    !!a.n3UserKey.trim() &&
    typeof a.n3Token === "string" &&
    !!a.n3Token.trim() &&
    !/[\r\n]/.test(a.n3Token)
  );
}
function sameActor(a: SettlementActor, b: SettlementActor) {
  return (
    validActor(a) &&
    a.tenantId === b.tenantId &&
    a.reservationId === b.reservationId &&
    a.n3UserKey === b.n3UserKey &&
    a.n3Token === b.n3Token &&
    a.role === b.role
  );
}
const money = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY_CENTS;
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** One instance per operation. No shared/global or cross-session master cache.
 * Reuses transport's lossless parser, exact provenance, byte/deadline fences and
 * manual redirect handling. The exported diagnostic JSON cannot satisfy this port.
 */
export function createCurrentSettlementMasters(
  actor: SettlementActor,
  options: {
    invalidateSession?: () => Promise<void>;
    limit?: BillingReadLimit;
    authorize?: (actor: SettlementActor) => Promise<boolean>;
  } = {},
) {
  const boundActor = Object.freeze({ ...actor });
  const controller = new AbortController();
  if (options.limit?.signal.aborted) controller.abort();
  else options.limit?.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const limit: BillingReadLimit = {
    deadlineAt: Math.min(Date.now() + 30_000, options.limit?.deadlineAt ?? Infinity),
    signal: controller.signal,
    budget: options.limit?.budget ?? { remainingBytes: 2_000_000 },
  };
  const cache = new Map<string, Promise<EvidenceResult<Observation>>>();
  let terminal: string | null = null;
  function access(a: SettlementActor): EvidenceResult<never> | null {
    if (!sameActor(a, boundActor)) return contradiction("master_actor_scope_mismatch");
    if (terminal) return unavailable(terminal);
    if (Date.now() >= limit.deadlineAt || controller.signal.aborted)
      return unavailable("n3_master_deadline");
    return null;
  }
  async function permitted(a: SettlementActor): Promise<EvidenceResult<never> | null> {
    const denied = access(a);
    if (denied) return denied;
    if (options.authorize) {
      let allowed = false;
      try {
        allowed = await options.authorize(a);
      } catch {
        /* Fail closed before the next read. */
      }
      if (!allowed) {
        terminal = "n3_session_expired";
        controller.abort();
        return unavailable(terminal);
      }
    }
    return access(a);
  }
  async function read(
    a: SettlementActor,
    kind: MasterKind,
    id: number | string,
  ): Promise<EvidenceResult<Observation>> {
    const denied = await permitted(a);
    if (denied) return denied;
    const key = `${kind}:${String(id).toLowerCase()}`;
    let result = cache.get(key);
    if (!result) {
      if (cache.size >= 128) return unavailable("n3_master_read_limit");
      result = (async (): Promise<EvidenceResult<Observation>> => {
        try {
          const out = await readSettlementMaster(boundActor, kind, id, limit);
          if (out.kind === "response" && (out.status === 401 || out.status === 403)) {
            terminal = out.status === 401 ? "n3_unauthorized" : "n3_master_forbidden";
            controller.abort();
            if (out.status === 401) {
              try {
                await options.invalidateSession?.();
              } catch {
                /* Terminal even when session cleanup fails. */
              }
            }
            return unavailable(terminal);
          }
          const stopped = access(a);
          if (stopped) return stopped;
          if (
            out.kind !== "response" ||
            out.status !== 200 ||
            !billingMasterBoundTo(out, boundActor, kind, id)
          )
            return unavailable("n3_master_read_unavailable");
          // Current live envelopes can explicitly reject despite an HTTP200.
          const envelope = out.body as Record<string, unknown> | null;
          if (envelope?.success === false || envelope?.isSuccessful === false)
            return unavailable("n3_master_response_rejected");
          const parsed = parseObservedSettlementMaster(kind, id, out.body);
          if (parsed.kind !== "confirmed") return parsed;
          return {
            kind: "confirmed",
            value: { fields: parsed.value, fingerprint: billingPayloadDigest(out.body) },
          };
        } catch {
          return unavailable("n3_master_read_unavailable");
        }
      })();
      cache.set(key, result);
    }
    const out = await result;
    return (await permitted(a)) ?? out;
  }
  async function customer(a: SettlementActor, id: number) {
    const c = await read(a, "customer", id);
    if (c.kind !== "confirmed") return c;
    const activity = verifySettlementCustomerActivity(c.value.fields.status);
    return activity.kind === "confirmed" ? c : activity;
  }
  async function readCustomer(
    a: SettlementActor,
    id: number,
  ): Promise<EvidenceResult<{ tenantId: string; customerId: number; active: boolean }>> {
    const c = await customer(a, id);
    return c.kind === "confirmed"
      ? {
          kind: "confirmed",
          value: { tenantId: boundActor.tenantId, customerId: id, active: true },
        }
      : c;
  }
  async function verifyLine(
    a: SettlementActor,
    h: Header,
    l: ChargeLine,
  ): Promise<EvidenceResult<ChargeLine>> {
    const denied = access(a);
    if (denied) return denied;
    if (h.currency !== "MYR" || h.currencyRate !== 1)
      return unavailable("master_currency_unsupported");
    if (
      !Number.isInteger(l.qty) ||
      l.qty < 1 ||
      l.qty > 9999 ||
      ![l.unitCents, l.subtotalCents, l.taxCents, l.totalCents].every(money) ||
      l.subtotalCents !== l.unitCents * l.qty ||
      l.totalCents !== l.subtotalCents + l.taxCents
    )
      return contradiction("master_charge_amount_mismatch");
    const seen: Observation[] = [];
    const c = await customer(a, h.customerId);
    if (c.kind !== "confirmed") return c;
    seen.push(c.value);
    if (c.value.fields.currencyId !== h.currencyId || c.value.fields.currencyCode !== h.currency)
      return contradiction("master_currency_mismatch");
    const curr = await read(a, "currency", h.currencyId);
    if (curr.kind !== "confirmed") return curr;
    seen.push(curr.value);
    const currencyFields = curr.value.fields;
    function currencyAgrees(value: unknown): boolean {
      if (value === undefined) return true;
      const c = value as Record<string, unknown>;
      return (
        c.id === h.currencyId &&
        c.code === h.currency &&
        ["local", "salesRate", "purchaseRate"].every(
          (key) => c[key] === undefined || c[key] === currencyFields[key],
        )
      );
    }
    if (!currencyAgrees(c.value.fields.currencyObservation))
      return contradiction("master_currency_mismatch");
    const stock = await read(a, "stock", l.stockId);
    if (stock.kind !== "confirmed") return stock;
    seen.push(stock.value);
    const unit = await read(a, "uom", l.uomId);
    if (unit.kind !== "confirmed") return unit;
    seen.push(unit.value);
    const member = (stock.value.fields.uoms as Array<Record<string, unknown>>).find(
      (u) => u.id === l.uomId,
    );
    if (
      !member ||
      member.stockId !== l.stockId ||
      unit.value.fields.stockId !== l.stockId ||
      member.code !== unit.value.fields.code ||
      member.rate !== unit.value.fields.rate
    )
      return contradiction("master_relationship_mismatch");
    const t = await read(a, "tax", l.taxCodeId);
    if (t.kind !== "confirmed") return t;
    seen.push(t.value);
    const taxBp = Math.round(Number(t.value.fields.rate) * 10000);
    if (
      Math.abs(Number(t.value.fields.rate) * 10000 - taxBp) > 1e-8 ||
      Number((BigInt(l.subtotalCents) * BigInt(taxBp) + 5000n) / 10000n) !== l.taxCents
    )
      return contradiction("master_tax_amount_mismatch");
    const mappings = [
      {
        prefix: "ar",
        id: c.value.fields.controlAccountId,
        code: c.value.fields.controlAccountCode,
        type: "BCA",
        reference: c.value.fields.controlAccount,
      },
      {
        prefix: "sales",
        id: stock.value.fields.revenueAccountId,
        code: stock.value.fields.revenueAccountCode,
        type: "INC",
        reference: stock.value.fields.revenueAccount,
      },
      {
        prefix: "tax",
        id: t.value.fields.postingAccountId,
        code: t.value.fields.postingAccountCode,
        type: "BCL",
        reference: t.value.fields.postingAccount,
      },
    ];
    const mapping: Record<string, unknown> = {
      customerId: h.customerId,
      customerCode: c.value.fields.code,
      currencyId: h.currencyId,
      taxRateBp: taxBp,
      masterContract: "n3-local-myr-masters-v1",
    };
    for (const m of mappings) {
      const checked = await read(a, "account", m.id as string);
      if (checked.kind !== "confirmed") return checked;
      const f = checked.value.fields;
      const reference = m.reference as Record<string, unknown>;
      const own = f.accountObservation as Record<string, unknown>;
      if (
        f.id !== m.id ||
        f.code !== m.code ||
        f.typeCode !== m.type ||
        f.currencyId !== h.currencyId ||
        f.currencyCode !== h.currency ||
        !currencyAgrees(reference.currency) ||
        !currencyAgrees(own.currency) ||
        (reference.typeCode !== undefined && reference.typeCode !== f.typeCode) ||
        (reference.typeId !== undefined && reference.typeId !== f.accountTypeId)
      )
        return contradiction("master_posting_account_mismatch");
      mapping[m.prefix + "AccountId"] = f.id;
      mapping[m.prefix + "AccountCode"] = f.code;
      seen.push(checked.value);
    }
    const expired = access(a);
    if (expired) return expired;
    mapping.masterFingerprints = [...new Set(seen.map((s) => s.fingerprint))].sort();
    return { kind: "confirmed", value: { ...copy(l), mappingEvidence: mapping } };
  }
  function checkCurrent(a: SettlementActor): EvidenceResult<true> {
    return access(a) ?? { kind: "confirmed", value: true };
  }
  async function readHeader(
    a: SettlementActor,
    customerId: number,
    currency: string,
  ): Promise<EvidenceResult<Header>> {
    const c = await customer(a, customerId);
    if (c.kind !== "confirmed") return c;
    if (currency !== "MYR" || c.value.fields.currencyCode !== currency)
      return contradiction("master_currency_mismatch");
    const currencyId = c.value.fields.currencyId as number;
    const observed = await read(a, "currency", currencyId);
    if (observed.kind !== "confirmed") return observed;
    const nested = c.value.fields.currencyObservation as Record<string, unknown>;
    if (
      observed.value.fields.code !== currency ||
      ["id", "code", "local", "salesRate", "purchaseRate"].some(
        (key) => nested[key] !== undefined && nested[key] !== observed.value.fields[key],
      )
    )
      return contradiction("master_currency_mismatch");
    return { kind: "confirmed", value: { customerId, currencyId, currency, currencyRate: 1 } };
  }
  async function readBillingCustomer(a: SettlementActor, customerId: number, currency: string) {
    const h = await readHeader(a, customerId, currency);
    if (h.kind !== "confirmed") return h;
    const c = await customer(a, customerId);
    if (c.kind !== "confirmed") return c;
    if (!c.value.fields.billTo) return unavailable("master_customer_contact_unproven");
    return {
      kind: "confirmed" as const,
      value: {
        tenantId: boundActor.tenantId,
        customerId,
        currencyId: h.value.currencyId,
        currencyRate: h.value.currencyRate,
        billTo: copy(c.value.fields.billTo as BillToSnapshot),
      },
    };
  }
  async function resolveRoomUom(
    a: SettlementActor,
    stockId: number,
  ): Promise<EvidenceResult<number>> {
    const stock = await read(a, "stock", stockId);
    if (stock.kind !== "confirmed") return stock;
    const units = stock.value.fields.uoms as Array<Record<string, unknown>>;
    // No configured room UOM exists on older snapshots. A sole active unit
    // with conversion 1 is unambiguous; multiple choices require a saved UOM.
    if (units.length !== 1 || units[0].rate !== 1)
      return unavailable("settlement_room_uom_required");
    return { kind: "confirmed", value: units[0].id as number };
  }
  return {
    readCustomer,
    readHeader,
    readBillingCustomer,
    resolveRoomUom,
    verifyLine,
    checkCurrent,
  };
}

/** Compose with the separately scoped folio/deposit facts and receipt prover.
 * No local DB truth is fabricated here; installed schema/facts mapping and exact
 * receipt/GL proof remain required ports. This function cannot enable a writer.
 */
export function createSettlementMasterAdapter(
  actor: SettlementActor,
  ports: Omit<SnapshotDeps, "verifyLine"> & { invalidateSession?: () => Promise<void> },
): SnapshotDeps {
  const boundActor = Object.freeze({ ...actor }),
    masters = createCurrentSettlementMasters(boundActor, ports);
  let header: Header | null = null;
  return {
    now: ports.now,
    async readFacts(scope) {
      if (
        scope.tenantId !== boundActor.tenantId ||
        scope.reservationId !== boundActor.reservationId
      )
        return null;
      const f = await ports.readFacts(scope);
      if (!f) return null;
      const facts = copy(f);
      header =
        facts.tenantId === scope.tenantId && facts.reservationId === scope.reservationId
          ? {
              customerId: facts.customerId,
              currencyId: facts.currencyId,
              currency: facts.currency,
              currencyRate: facts.currencyRate,
            }
          : null;
      return facts;
    },
    async verifyLine(a, l) {
      return header
        ? masters.verifyLine(a, header, l)
        : unavailable("master_snapshot_facts_missing");
    },
    async verifyReceipt(a, r) {
      if (!sameActor(a, boundActor) || r.reservationId !== boundActor.reservationId)
        return contradiction("receipt_scope_mismatch");
      const before = masters.checkCurrent(a);
      if (before.kind !== "confirmed") return before;
      const result = await ports.verifyReceipt(boundActor, r);
      const after = masters.checkCurrent(a);
      return after.kind === "confirmed" ? result : after;
    },
  };
}
