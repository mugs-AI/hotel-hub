import type { HotelRole } from "./rbac";
export type MasterCaptureActor = {
  tenantId: string;
  n3UserKey: string;
  n3Token: string;
  role: HotelRole;
};
export type MasterKind = "customer" | "currency" | "stock" | "uom" | "tax" | "account";
export type MasterCaptureInput = { masters: Array<{ kind: MasterKind; id: number | string }> };
export type MasterCaptureFailure =
  | "transport_error"
  | "request_timeout"
  | "batch_deadline"
  | "response_limit"
  | "redirect_refused"
  | "http_error"
  | "body_unavailable"
  | "invalid_response";
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
    // Optional for compatibility with earlier exports; new captures always set these.
    attempted?: boolean;
    durationMs?: number;
    failureReason?: MasterCaptureFailure | null;
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
  "controlaccount",
  "accountpreset",
  "cashsalesaccount",
  "postingaccount",
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
  "controlaccountid",
  "accountpresetid",
  "postingaccountid",
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
  "defaultsalesrate",
  "defaultpurchaserate",
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
  "isbase",
  "local",
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
    if (safePath && codeKeys.has(field) && /^[a-z0-9][a-z0-9._ /%-]{0,99}$/i.test(value))
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
    return safePath &&
      (idKeys.has(field) ||
        numberKeys.has(field) ||
        (field === "status" &&
          path.length === 1 &&
          path[0] === "data" &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 255)) &&
      Number.isFinite(value)
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
      attempted: false,
      durationMs: 0,
      failureReason: null,
    };
    report.evidence.push(item);
    if (now() >= deadline || bytes <= 0) {
      item.failureReason = now() >= deadline ? "batch_deadline" : "response_limit";
      report.status = "partial";
      continue;
    }
    const controller = new AbortController();
    const started = now();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async () => {
        item.attempted = true;
        const response = await fetcher("https://openapi.account.qne.cloud" + endpoint, {
          method: "GET",
          // workerd rejects redirect:error before dispatch. Manual prevents
          // forwarding Authorization; every returned 3xx is refused below.
          redirect: "manual",
          headers: { authorization: "Bearer " + boundActor.n3Token, accept: "application/json" },
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          try {
            void response.body?.cancel().catch(() => {});
          } catch {
            /* cleanup only */
          }
          controller.signal.throwIfAborted();
        }
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
          item.failureReason =
            response.status >= 300 && response.status < 400 ? "redirect_refused" : "http_error";
          try {
            void response.body?.cancel().catch(() => {});
          } catch {
            /* cleanup only */
          }
          return;
        }
        const declared = response.headers.get("content-length");
        if (declared !== null && Number(declared) > bytes) {
          bytes = 0;
          item.failureReason = "response_limit";
          try {
            void response.body?.cancel().catch(() => {});
          } catch {
            /* cleanup only */
          }
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          item.failureReason = "body_unavailable";
          return;
        }
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "";
        try {
          while (true) {
            const chunk = await reader.read();
            controller.signal.throwIfAborted();
            if (chunk.done) break;
            bytes -= chunk.value.byteLength;
            if (bytes < 0) {
              item.failureReason = "response_limit";
              void reader.cancel().catch(() => {});
              return;
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        const body = parseN3LosslessJson(text);
        controller.signal.throwIfAborted();
        if (!obj(body) || body.code !== "0000" || !obj(body.data)) {
          item.failureReason = "invalid_response";
          return;
        }
        item.responseHash = createHash("sha256").update(text).digest("hex");
        item.sample = sample(body, boundActor);
        item.sampleTruncated = truncated(body);
        item.status = "captured";
      };
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              timedOut = true;
              controller.abort();
              reject(Error("deadline"));
            },
            Math.max(1, Math.min(5000, deadline - now())),
          );
        }),
      ]);
    } catch {
      item.status = item.httpStatus === 401 ? "unauthorized" : "unavailable";
      item.failureReason = timedOut
        ? "request_timeout"
        : item.httpStatus === null
          ? "transport_error"
          : "invalid_response";
      item.responseHash = null;
      item.sample = null;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      item.durationMs = Math.max(0, now() - started);
    }
    if (item.status === "unauthorized") {
      report.status = "unauthorized";
      break;
    }
    if (item.status !== "captured" || item.sampleTruncated) report.status = "partial";
  }
  return report;
}
