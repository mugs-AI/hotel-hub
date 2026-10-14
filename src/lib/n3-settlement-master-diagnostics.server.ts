import type { HotelRole } from "./rbac";
export type MasterCaptureActor = {
  tenantId: string;
  n3UserKey: string;
  n3Token: string;
  role: HotelRole;
};
export type MasterKind = "customer" | "currency" | "stock" | "uom" | "tax" | "account";
export type MasterCaptureInput = { masters: Array<{ kind: MasterKind; id: number | string }> };
export type MasterCapture = {
  schemaVersion: "hh-master-capture-v1";
  status: "captured" | "partial" | "unauthorized";
  capturedAt: string;
  contractAccepted: false;
  evidence: Array<{
    kind: MasterKind;
    id: number | string;
    endpoint: string;
    method: "GET";
    status: "captured" | "unavailable" | "unauthorized";
    httpStatus: number | null;
    responseHash: string | null;
    sample: unknown;
    sampleTruncated: boolean;
  }>;
};
import { createHash } from "node:crypto";
import { parseN3LosslessJson } from "./n3-lossless-json.server";
import { isN3Guid } from "./n3-guid";
const paths: Record<MasterKind, string> = {
  customer: "Customers",
  currency: "Currencies",
  stock: "Stocks",
  uom: "UOMs",
  tax: "TaxCodes",
  account: "AccountCodes",
};
const obj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const masterId = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
export function validateMasterCapture(input: MasterCaptureInput): void {
  if (
    !obj(input) ||
    Object.keys(input).some((k) => k !== "masters") ||
    !Array.isArray(input.masters) ||
    !input.masters.length ||
    input.masters.length > 20
  )
    throw Error("invalid_request");
  const ids = new Set<string>();
  for (const row of input.masters) {
    if (
      !obj(row) ||
      Object.keys(row).some((k) => !["kind", "id"].includes(k)) ||
      !Object.hasOwn(paths, row.kind) ||
      !(row.kind === "account" ? isN3Guid(row.id) : masterId(row.id))
    )
      throw Error("invalid_request");
    const key = `${row.kind}:${String(row.id).toLowerCase()}`;
    if (ids.has(key)) throw Error("invalid_request");
    ids.add(key);
  }
}
// Positive allowlists retain only the mapping graph needed for review. Unknown
// scalars retain their type marker, never their value (including numeric PII).
const graphKeys = new Set([
  "data",
  "customer",
  "currency",
  "stock",
  "uom",
  "uoms",
  "stockuoms",
  "uomdetails",
  "baseuom",
  "taxcode",
  "taxcodes",
  "tax",
  "account",
  "accountcode",
  "accounttype",
  "accountcodetype",
  "type",
  "parentaccount",
  "salesaccount",
  "revenueaccount",
  "araccount",
  "debtoraccount",
  "debtorscontrolaccount",
  "salesreturnaccount",
  "purchaseaccount",
  "taxaccount",
  "inputtaxaccount",
  "outputtaxaccount",
  "roundingaccount",
  "currencyrateperiods",
]);
const idKeys = new Set([
  "id",
  "customerid",
  "currencyid",
  "stockid",
  "uomid",
  "baseuomid",
  "taxcodeid",
  "accountid",
  "accounttypeid",
  "salesaccountid",
  "revenueaccountid",
  "araccountid",
  "debtoraccountid",
  "debtorscontrolaccountid",
  "salesreturnaccountid",
  "purchaseaccountid",
  "taxaccountid",
  "inputtaxaccountid",
  "outputtaxaccountid",
  "roundingaccountid",
  "stockgroupid",
  "stockcategoryid",
  "stockclassid",
]);
const codeKeys = new Set([
  "code",
  "customercode",
  "currencycode",
  "stockcode",
  "uomcode",
  "taxcode",
  "accountcode",
  "typecode",
  "naturecode",
  "status",
  "customerstatus",
  "stockstatus",
  "type",
  "nature",
]);
const numberKeys = new Set([
  "rate",
  "currencyrate",
  "salesprice",
  "listprice",
  "purchaseprice",
  "costprice",
  "standardcost",
  "quantity",
  "qty",
  "conversionrate",
  "conversionfactor",
  "decimalplaces",
]);
const booleanKeys = new Set([
  "isactive",
  "active",
  "inactive",
  "isinactive",
  "isparent",
  "isdisabled",
  "issuspended",
  "isstopped",
  "istaxable",
  "isoutputtax",
  "isbaseuom",
  "isdefault",
  "isbankaccount",
  "iscashaccount",
  "allowposting",
]);
const dateKeys = new Set([
  "datefrom",
  "dateto",
  "effectivefrom",
  "effectiveto",
  "validfrom",
  "validto",
  "lastmodifieddate",
  "modifieddate",
  "createddate",
]);
function sample(
  value: unknown,
  actor: MasterCaptureActor,
  key = "",
  depth = 0,
  path: string[] = [],
): unknown {
  if (depth > 12) return "[depth_limited]";
  const safePath = path.every((k) => graphKeys.has(k));
  const field = key.toLowerCase();
  if (typeof value === "string") {
    if (value.includes(actor.n3Token) || value.includes(actor.tenantId)) return "[redacted_string]";
    if (safePath && idKeys.has(field) && (isN3Guid(value) || /^[0-9]{1,40}$/.test(value)))
      return value;
    if (safePath && codeKeys.has(field) && /^[a-z0-9][a-z0-9._ /-]{0,99}$/i.test(value))
      return value;
    if (safePath && dateKeys.has(field) && /^\d{4}-\d\d-\d\d(?:T[0-9:.+-]+Z?)?$/.test(value))
      return value;
    if (safePath && numberKeys.has(field) && /^-?\d+(?:\.\d+)?$/.test(value)) return value;
    return "[redacted_string]";
  }
  if (Array.isArray(value))
    return value.slice(0, 100).map((v) => sample(v, actor, key, depth + 1, path));
  if (obj(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            /^[a-z_][a-z0-9_]{0,79}$/i.test(k) &&
            !/(token|authorization|password|secret|bearer|cookie|tenant)/i.test(k) &&
            !k.includes(actor.n3Token),
        )
        .map(([k, v]) => [
          k,
          sample(
            v,
            actor,
            k,
            depth + 1,
            obj(v) || Array.isArray(v) ? [...path, k.toLowerCase()] : path,
          ),
        ]),
    );
  if (typeof value === "number")
    return safePath && (idKeys.has(field) || numberKeys.has(field)) && Number.isFinite(value)
      ? value
      : "[redacted_number]";
  if (typeof value === "boolean")
    return safePath && booleanKeys.has(field) ? value : "[redacted_boolean]";
  return null;
}
function truncated(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.length > 100 || value.some((v) => truncated(v, depth + 1));
  return obj(value) && Object.values(value).some((v) => truncated(v, depth + 1));
}
export async function captureSettlementMasters(
  actor: MasterCaptureActor,
  input: MasterCaptureInput,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<MasterCapture> {
  if (
    actor.role !== "owner" ||
    !isN3Guid(actor.tenantId) ||
    !actor.n3UserKey?.trim() ||
    !actor.n3Token?.trim() ||
    /[\r\n]/.test(actor.n3Token)
  )
    throw Error("forbidden");
  validateMasterCapture(input);
  const manifest = input.masters.map((row) => ({ ...row }));
  const boundActor = { ...actor };
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const deadline = now() + 30000;
  let bytes = 1_000_000;
  const report: MasterCapture = {
    schemaVersion: "hh-master-capture-v1",
    capturedAt: new Date(now()).toISOString(),
    status: "captured",
    contractAccepted: false,
    evidence: [],
  };
  for (const row of manifest) {
    const endpoint = `/api/${paths[row.kind]}/${encodeURIComponent(String(row.id))}`;
    const item: MasterCapture["evidence"][number] = {
      ...row,
      endpoint,
      method: "GET",
      status: "unavailable",
      httpStatus: null,
      responseHash: null,
      sample: null,
      sampleTruncated: false,
    };
    report.evidence.push(item);
    if (now() >= deadline || bytes <= 0) {
      report.status = "partial";
      continue;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async () => {
        const response = await fetcher("https://openapi.account.qne.cloud" + endpoint, {
          method: "GET",
          redirect: "error",
          headers: { authorization: "Bearer " + boundActor.n3Token, accept: "application/json" },
          signal: controller.signal,
        });
        item.httpStatus = response.status;
        if (response.status === 401) {
          item.status = "unauthorized";
          // Cleanup cannot veto terminal authentication failure or delay
          // ending the session. A rejection is handled; a hung cancel is not awaited.
          try {
            void response.body?.cancel().catch(() => {});
          } catch {
            /* cleanup only */
          }
          return;
        }
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const declared = response.headers.get("content-length");
        if (declared !== null && Number(declared) > bytes) {
          await response.body?.cancel();
          bytes = 0;
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes -= chunk.value.byteLength;
            if (bytes < 0) {
              await reader.cancel();
              return;
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        const body = parseN3LosslessJson(text);
        if (!obj(body) || body.code !== "0000" || !obj(body.data)) return;
        item.responseHash = createHash("sha256").update(text).digest("hex");
        controller.signal.throwIfAborted();
        item.sample = sample(body, boundActor);
        item.sampleTruncated = truncated(body);
        item.status = "captured";
      };
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(Error("deadline"));
            },
            Math.max(1, Math.min(5000, deadline - now())),
          );
        }),
      ]);
    } catch {
      item.status = item.httpStatus === 401 ? "unauthorized" : "unavailable";
      item.responseHash = null;
      item.sample = null;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
    if (item.status === "unauthorized") {
      report.status = "unauthorized";
      break;
    }
    if (item.status !== "captured" || item.sampleTruncated) report.status = "partial";
  }
  return report;
}
