// HH-GOLIVE-01A UAT correction — Owner-only "Charges & Taxes" workspace.
//
// Three concerns live here: the add-on catalogue (what can be charged, and how
// each item maps to N3 stock / unit of measure / tax code), the Malaysian tax
// and levy configuration, and the future-posting accounting mappings.
//
// PREPARATION ONLY. Nothing on this screen posts to N3. The mapping is
// captured now so the later posting milestone has a complete, verified
// contract.
//
// Deliberate UX rules:
//   * Dates are Malaysian dd/mm/yyyy on screen and ISO yyyy-mm-dd on the wire.
//   * No N3 identifier is ever shown or typed. Every N3 value comes from a
//     searchable selector that displays a code and a name.
//   * Every type stays visible in a left-hand list. Its checkbox controls use;
//     selecting it opens the retained configuration on the right.
//   * No rate is ever guessed or suggested. A Service Tax rate comes from the
//     chosen N3 Output Tax code and is re-read and overwritten by the server on
//     save, because a guessed tax rate is a legal problem, not a convenience.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { N3Picker } from "@/components/N3Picker";
import { N3SelectorField, type N3Selection } from "@/components/N3SelectorField";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import {
  folioErrorMessage,
  useChargeCatalogue,
  useChargeSettings,
  useSaveCatalogueItem,
  useSaveChargeSettings,
  type CatalogueItemDTO,
} from "@/lib/folio-client";
import {
  ADDON_CATEGORIES,
  ADDON_CATEGORY_LABELS,
  TAX_CLASSES,
  TAX_CLASS_LABELS,
  type AddonCategory,
  type TaxClass,
} from "@/lib/charges-catalogue";
import { type FinancialSettings, type TaxableClass } from "@/lib/financial-settings";
import {
  POSTING_COMPONENTS,
  POSTING_COMPONENT_HINTS,
  POSTING_COMPONENT_LABELS,
  type PostingComponent,
  type PostingMappings,
} from "@/lib/posting-mappings";
import {
  MAPPING_ROW_STATUS_LABELS,
  NOT_POSTED_NOTICE,
  type PostingReadiness,
} from "@/lib/posting-readiness";
import { isValidIsoDate } from "@/lib/malaysia-date";
import { formatRateBpPercent } from "@/lib/n3-selectors";
import { ROUNDING_MODES, type RoundingMode } from "@/lib/folio-money";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const ERR = "#C2413B";

const TAXABLE_CLASSES: readonly TaxableClass[] = [
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
];

const TAXABLE_CLASS_LABELS: Record<TaxableClass, string> = {
  accommodation: "Accommodation",
  food_and_beverage: "Food & beverage",
  parking: "Parking",
  other_taxable_service: "Other taxable service",
};

const ROUNDING_LABELS: Record<RoundingMode, string> = {
  none: "No rounding",
  nearest_5_cents: "Nearest 5 sen",
  nearest_10_cents: "Nearest 10 sen",
};

/** Display helpers. Money is entered in ringgit and stored in integer cents. */
function bpToPercentText(bp: number | null): string {
  return bp === null ? "" : String(bp / 100);
}
function percentTextToBp(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100);
}
function centsToText(cents: number): string {
  return (cents / 100).toFixed(2);
}
function textToCents(text: string): number | undefined {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}
function orNull(text: string): string | null {
  const t = text.trim();
  return t ? t : null;
}
function snapshotText(sel: { code: string | null; name: string | null }): string | null {
  if (!sel.code) return null;
  return sel.name ? `${sel.code} — ${sel.name}` : sel.code;
}

/** Real-calendar + ordering check for an effective window. */
export function effectiveWindowError(fromIso: string, toIso: string): string | null {
  if (fromIso && !isValidIsoDate(fromIso))
    return "Enter a real 'effective from' date (dd/mm/yyyy).";
  if (toIso && !isValidIsoDate(toIso)) return "Enter a real 'effective to' date (dd/mm/yyyy).";
  if (fromIso && toIso && toIso < fromIso) {
    return "'Effective to' cannot be earlier than 'effective from'.";
  }
  return null;
}

type Draft = {
  displayName: string;
  category: AddonCategory;
  taxClass: TaxClass;
  defaultUnitPrice: string;
};

const EMPTY_DRAFT: Draft = {
  displayName: "",
  category: "minibar",
  taxClass: "food_and_beverage",
  defaultUnitPrice: "",
};

export function ChargesTaxesPanel() {
  const catalogue = useChargeCatalogue();
  const settings = useChargeSettings();
  const saveItem = useSaveCatalogueItem();
  const saveSettings = useSaveChargeSettings();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const canManage = catalogue.data?.capability.canManage ?? false;

  if (catalogue.error || settings.error) {
    return (
      <p className="text-sm" style={{ color: ERR }}>
        {folioErrorMessage(catalogue.error ?? settings.error, "Unable to load charges and taxes.")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}0F`, color: NAVY }}
        data-testid="not-posted-notice"
      >
        {NOT_POSTED_NOTICE}
      </p>

      <section
        className="rounded-xl border bg-white p-5 shadow-sm"
        style={{ borderColor: `${NAVY}1F` }}
      >
        <h2 className="text-base font-semibold" style={{ color: NAVY }}>
          Malaysian taxes and levies
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Tick a type on or off, then select it to configure the settings on the right.
        </p>
        {settings.data?.settings ? (
          <TaxSettingsForm
            disabled={!canManage || saveSettings.isPending}
            settings={settings.data.settings}
            onSave={(patch) =>
              saveSettings.mutate(patch, {
                onSuccess: () => toast.success("Tax settings saved."),
                onError: (err) => toast.error(folioErrorMessage(err)),
              })
            }
            onSaveMapping={(patch) =>
              saveSettings.mutate(patch, {
                onSuccess: () => toast.success("N3 mapping saved."),
                onError: (err) => toast.error(folioErrorMessage(err)),
              })
            }
          />
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        )}
        {settings.data?.readiness.missing.length ? (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {settings.data.readiness.missing.map((m) => (
              <li key={m}>Still to configure: {m}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {settings.data?.settings ? (
        <PostingMappingsSection
          settings={settings.data.settings}
          posting={settings.data.posting ?? null}
          disabled={!canManage || saveSettings.isPending}
          onSave={(patch) =>
            saveSettings.mutate(patch, {
              onSuccess: () => toast.success("Accounting mapping saved."),
              onError: (err) => toast.error(folioErrorMessage(err)),
            })
          }
        />
      ) : null}

      <section
        className="rounded-xl border bg-white p-5 shadow-sm"
        style={{ borderColor: `${NAVY}1F` }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: NAVY }}>
            Charge catalogue
          </h2>
          <span className="text-sm text-muted-foreground">
            {catalogue.data?.items.length ?? 0} items
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          An item can only be charged once its N3 stock, unit of measure and tax code are chosen and
          verified.
        </p>

        <ul className="mt-4 space-y-2">
          {(catalogue.data?.items ?? []).map((item) => (
            <CatalogueRow
              key={item.id}
              item={item}
              disabled={!canManage || saveItem.isPending}
              onSave={(body) =>
                saveItem.mutate(
                  { id: item.id, body },
                  {
                    onSuccess: () => toast.success("Charge item updated."),
                    onError: (err) => toast.error(folioErrorMessage(err)),
                  },
                )
              }
            />
          ))}
        </ul>

        {canManage ? (
          <div className="mt-5 grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="charge-name">Item name</Label>
              <Input
                id="charge-name"
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="charge-category">Category</Label>
              <select
                id="charge-category"
                className="mt-1 w-full rounded border px-2 py-2 text-sm"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as AddonCategory })}
              >
                {ADDON_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ADDON_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="charge-tax">Tax treatment</Label>
              <select
                id="charge-tax"
                className="mt-1 w-full rounded border px-2 py-2 text-sm"
                value={draft.taxClass}
                onChange={(e) => setDraft({ ...draft, taxClass: e.target.value as TaxClass })}
              >
                {TAX_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CLASS_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="charge-price">Default price</Label>
              <Input
                id="charge-price"
                inputMode="decimal"
                value={draft.defaultUnitPrice}
                onChange={(e) => setDraft({ ...draft, defaultUnitPrice: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                style={{ backgroundColor: TEAL }}
                disabled={saveItem.isPending}
                onClick={() => {
                  const cents = textToCents(draft.defaultUnitPrice);
                  if (cents === undefined) {
                    toast.error("Enter a valid default price.");
                    return;
                  }
                  saveItem.mutate(
                    {
                      body: {
                        displayName: draft.displayName.trim(),
                        category: draft.category,
                        taxClass: draft.taxClass,
                        defaultUnitPriceCents: cents,
                      },
                    },
                    {
                      onSuccess: () => {
                        setDraft(EMPTY_DRAFT);
                        toast.success("Charge item added. Finish its N3 mapping next.");
                      },
                      onError: (err) => toast.error(folioErrorMessage(err)),
                    },
                  );
                }}
              >
                Add item
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- catalogue row

function CatalogueRow({
  item,
  disabled,
  onSave,
}: {
  item: CatalogueItemDTO;
  disabled: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(centsToText(item.defaultUnitPriceCents));
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setPrice(centsToText(item.defaultUnitPriceCents));
  }, [item.defaultUnitPriceCents]);

  const mapped = item.mappingStatus === "mapped";

  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium" style={{ color: NAVY }}>
            {item.displayName}
          </p>
          <p className="text-sm text-muted-foreground">
            {ADDON_CATEGORY_LABELS[item.category]} · {TAX_CLASS_LABELS[item.taxClass]} ·{" "}
            {centsToText(item.defaultUnitPriceCents)}
          </p>
          <p className="text-sm text-muted-foreground">
            N3 stock: {item.n3StockCodeSnapshot ?? "not chosen"}
            {item.n3StockNameSnapshot ? ` — ${item.n3StockNameSnapshot}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="rounded px-2 py-0.5 text-sm font-medium"
            style={{ backgroundColor: mapped ? "#E7F6F3" : "#FDF3E7", color: NAVY }}
          >
            {mapped ? "Ready to charge" : "Mapping incomplete"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSave({ isActive: !item.isActive })}
          >
            {item.isActive ? "Switch off" : "Switch on"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit mapping"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`price-${item.id}`}>Default price</Label>
              <Input
                id={`price-${item.id}`}
                inputMode="decimal"
                value={price}
                disabled={disabled}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <N3SelectorField
              kind="uom"
              label="Unit of measure"
              value={{ code: item.n3UomSnapshot ?? null, name: null }}
              disabled={disabled}
              stockId={item.n3StockId ?? null}
              onSelect={(row) => onSave({ n3UomId: row.id, n3UomSnapshot: snapshotText(row) })}
              onClear={() => onSave({ n3UomId: null, n3UomSnapshot: null })}
            />

            <N3SelectorField
              kind="tax_code"
              label="Tax code"
              value={{ code: item.n3TaxCodeSnapshot ?? null, name: null }}
              disabled={disabled}
              onSelect={(row) =>
                onSave({ n3TaxCodeId: row.id, n3TaxCodeSnapshot: snapshotText(row) })
              }
              onClear={() => onSave({ n3TaxCodeId: null, n3TaxCodeSnapshot: null })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setPicking((v) => !v)}
            >
              {picking ? "Cancel stock pick" : "Choose N3 stock"}
            </Button>
            <Button
              type="button"
              size="sm"
              style={{ backgroundColor: NAVY }}
              disabled={disabled}
              onClick={() => {
                const cents = textToCents(price);
                if (cents === undefined) {
                  toast.error("Enter a valid default price.");
                  return;
                }
                onSave({ defaultUnitPriceCents: cents });
              }}
            >
              Save price
            </Button>
          </div>

          {picking ? (
            <div className="rounded-md border p-3">
              <N3Picker
                kind="stocks"
                onPick={(row) => {
                  setPicking(false);
                  // Unit of measure is stock-linked: a stock change always
                  // clears the earlier unit and requires explicit reselection.
                  onSave({
                    n3StockId: row.id,
                    n3StockCodeSnapshot: row.code,
                    n3StockNameSnapshot: row.name ?? row.code,
                    n3UomId: null,
                    n3UomSnapshot: null,
                  });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------- posting mappings UI

function PostingMappingsSection({
  settings,
  posting,
  disabled,
  onSave,
}: {
  settings: FinancialSettings;
  posting: PostingReadiness | null;
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const mappings: PostingMappings = settings.postingMappings;

  function patchComponent(component: PostingComponent, value: Record<string, unknown>) {
    onSave({ postingMappings: { [component]: value } });
  }

  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold" style={{ color: NAVY }}>
            Accounting mapping
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tells the later posting milestone where each charge belongs in your accounts.{" "}
            {NOT_POSTED_NOTICE}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide details" : "Set up mappings"}
        </Button>
      </div>

      {posting ? (
        <>
          <p
            className="mt-3 text-sm font-medium"
            style={{ color: posting.readyForFuturePosting ? NAVY : ERR }}
            data-testid="posting-readiness"
          >
            {posting.readyForFuturePosting
              ? "Every mapping is complete and verified."
              : "Not ready for future posting."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Accounting mapping summary</caption>
              <thead>
                <tr style={{ color: NAVY }}>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    Charge
                  </th>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    N3 Stock
                  </th>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    Tax Code
                  </th>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    Resolved account
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {posting.rows.map((row) => (
                  <tr key={row.key} className="border-t align-top">
                    <td className="py-1 pr-3">{row.charge}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{row.stock}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{row.taxCode}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{row.resolvedAccount}</td>
                    <td className="py-1" style={{ color: row.status === "ready" ? NAVY : ERR }}>
                      {MAPPING_ROW_STATUS_LABELS[row.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {posting.blockedContracts.length ? (
            <ul className="mt-3 space-y-1 text-sm" style={{ color: ERR }}>
              {posting.blockedContracts.map((c) => (
                <li key={c.kind}>
                  {c.label}: N3 contract not yet verified. Still needed: {c.missingEvidence}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-4">
          {POSTING_COMPONENTS.map((component) => {
            const mapping = mappings[component];
            const forcedOn =
              (component === "service_charge" && settings.serviceCharge.enabled) ||
              (component === "tourism_tax" && settings.tourismTax.enabled) ||
              (component === "local_levy" && settings.localLevy.enabled);
            const isOn = forcedOn || mapping.enabled;
            return (
              <fieldset key={component} className="rounded-lg border p-3">
                <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
                  {POSTING_COMPONENT_LABELS[component]}
                </legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={disabled || forcedOn}
                    onChange={(e) => patchComponent(component, { enabled: e.target.checked })}
                  />
                  {forcedOn
                    ? "In use (switched on above)"
                    : `Use ${POSTING_COMPONENT_LABELS[component].toLowerCase()}`}
                </label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {POSTING_COMPONENT_HINTS[component]}
                </p>
                {isOn ? (
                  <PostingMappingFields
                    mapping={mapping}
                    disabled={disabled}
                    onPatch={(value) => patchComponent(component, value)}
                  />
                ) : null}
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function PostingMappingFields({
  mapping,
  disabled,
  onPatch,
}: {
  mapping: PostingMappings[PostingComponent];
  disabled: boolean;
  onPatch: (value: Record<string, unknown>) => void;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <N3SelectorField
        kind="stock"
        label="N3 stock / service"
        value={mapping.stock}
        disabled={disabled}
        onSelect={(row: N3Selection) =>
          onPatch({
            stock: { id: row.id, code: row.code, name: row.name },
            // UOM belongs to the stock: a stock change must clear it.
            uom: { id: null, code: null, name: null },
          })
        }
        onClear={() =>
          onPatch({
            stock: { id: null, code: null, name: null },
            uom: { id: null, code: null, name: null },
          })
        }
      />
      <N3SelectorField
        kind="uom"
        label="N3 UOM"
        value={mapping.uom}
        disabled={disabled}
        stockId={mapping.stock.id ?? null}
        onSelect={(row) => onPatch({ uom: { id: row.id, code: row.code, name: row.name } })}
        onClear={() => onPatch({ uom: { id: null, code: null, name: null } })}
      />
      <N3SelectorField
        kind="tax_code"
        label="N3 Tax Code"
        value={mapping.taxCode}
        disabled={disabled}
        onSelect={(row) => onPatch({ taxCode: { id: row.id, code: row.code, name: row.name } })}
        onClear={() => onPatch({ taxCode: { id: null, code: null, name: null } })}
      />
    </div>
  );
}

// ------------------------------------------------------------- tax settings

type TaxSettingsSection =
  | "service_tax"
  | "service_charge"
  | "tourism_tax"
  | "local_levy"
  | "rounding";

const TAX_SETTINGS_SECTION_LABELS: Record<TaxSettingsSection, string> = {
  service_tax: "Service Tax",
  service_charge: "Service charge",
  tourism_tax: "Tourism Tax",
  local_levy: "State / local levy",
  rounding: "Rounding",
};

const TAX_SETTINGS_SECTIONS = Object.keys(TAX_SETTINGS_SECTION_LABELS) as TaxSettingsSection[];

function TaxSettingsForm({
  settings,
  disabled,
  onSave,
  onSaveMapping,
}: {
  settings: FinancialSettings;
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onSaveMapping: (patch: Record<string, unknown>) => void;
}) {
  const [activeSection, setActiveSection] = useState<TaxSettingsSection>("service_tax");
  const [serviceTaxRegistered, setServiceTaxRegistered] = useState(false);
  // Service Tax rates are display-only: they mirror the live N3 rate of the
  // chosen Output Tax code and are never typed or sent by the browser.
  const [rates, setRates] = useState<Record<TaxableClass, number | null>>({
    accommodation: null,
    food_and_beverage: null,
    parking: null,
    other_taxable_service: null,
  });
  const [codes, setCodes] = useState<
    Record<TaxableClass, { id: string | null; text: string | null }>
  >({
    accommodation: { id: null, text: null },
    food_and_beverage: { id: null, text: null },
    parking: { id: null, text: null },
    other_taxable_service: { id: null, text: null },
  });
  const [exempt, setExempt] = useState<{ id: string | null; text: string | null }>({
    id: null,
    text: null,
  });
  const [scEnabled, setScEnabled] = useState(false);
  const [scPercent, setScPercent] = useState("");
  const [scTaxed, setScTaxed] = useState(false);
  const [ttEnabled, setTtEnabled] = useState(false);
  const [ttAmount, setTtAmount] = useState("");
  const [ttFrom, setTtFrom] = useState("");
  const [ttTo, setTtTo] = useState("");
  const [levyEnabled, setLevyEnabled] = useState(false);
  const [levyLabel, setLevyLabel] = useState("");
  const [levyAmount, setLevyAmount] = useState("");
  const [levyFrom, setLevyFrom] = useState("");
  const [levyTo, setLevyTo] = useState("");
  const [rounding, setRounding] = useState<RoundingMode>("none");
  const [roundingAccount, setRoundingAccount] = useState<{
    id: string | null;
    text: string | null;
  }>({ id: null, text: null });

  useEffect(() => {
    setServiceTaxRegistered(settings.serviceTaxRegistered);
    setRates({
      accommodation: settings.serviceTax.accommodation.rateBp,
      food_and_beverage: settings.serviceTax.food_and_beverage.rateBp,
      parking: settings.serviceTax.parking.rateBp,
      other_taxable_service: settings.serviceTax.other_taxable_service.rateBp,
    });
    setCodes({
      accommodation: {
        id: settings.serviceTax.accommodation.n3TaxCodeId,
        text: settings.serviceTax.accommodation.n3TaxCodeSnapshot,
      },
      food_and_beverage: {
        id: settings.serviceTax.food_and_beverage.n3TaxCodeId,
        text: settings.serviceTax.food_and_beverage.n3TaxCodeSnapshot,
      },
      parking: {
        id: settings.serviceTax.parking.n3TaxCodeId,
        text: settings.serviceTax.parking.n3TaxCodeSnapshot,
      },
      other_taxable_service: {
        id: settings.serviceTax.other_taxable_service.n3TaxCodeId,
        text: settings.serviceTax.other_taxable_service.n3TaxCodeSnapshot,
      },
    });
    setExempt({ id: settings.exempt.n3TaxCodeId, text: settings.exempt.n3TaxCodeSnapshot });
    setScEnabled(settings.serviceCharge.enabled);
    setScPercent(bpToPercentText(settings.serviceCharge.percentBp));
    setScTaxed(settings.serviceCharge.serviceTaxApplies);
    setTtEnabled(settings.tourismTax.enabled);
    setTtAmount(centsToText(settings.tourismTax.centsPerRoomNight));
    setTtFrom(settings.tourismTax.effectiveFrom ?? "");
    setTtTo(settings.tourismTax.effectiveTo ?? "");
    setLevyEnabled(settings.localLevy.enabled);
    setLevyLabel(settings.localLevy.label ?? "");
    setLevyAmount(centsToText(settings.localLevy.centsPerRoomNight));
    setLevyFrom(settings.localLevy.effectiveFrom ?? "");
    setLevyTo(settings.localLevy.effectiveTo ?? "");
    setRounding(settings.rounding.mode);
    setRoundingAccount({
      id: settings.rounding.n3RoundingAccountId,
      text: settings.rounding.n3RoundingAccountSnapshot,
    });
  }, [settings]);

  function submit() {
    const serviceTax: Record<string, unknown> = {};
    for (const c of TAXABLE_CLASSES) {
      // No rate is sent: the server re-reads it from the chosen N3 tax code.
      serviceTax[c] = {
        n3TaxCodeId: codes[c].id,
        n3TaxCodeSnapshot: codes[c].text,
      };
    }
    const scBp = percentTextToBp(scPercent);
    if (scBp === undefined) {
      toast.error("Enter a valid service charge percentage.");
      return;
    }
    const ttCents = textToCents(ttAmount);
    const levyCents = textToCents(levyAmount);
    if (ttCents === undefined || levyCents === undefined) {
      toast.error("Enter valid per-room-night amounts.");
      return;
    }
    const ttWindow = effectiveWindowError(ttFrom, ttTo);
    if (ttWindow) {
      toast.error(`Tourism Tax: ${ttWindow}`);
      return;
    }
    const levyWindow = effectiveWindowError(levyFrom, levyTo);
    if (levyWindow) {
      toast.error(`Local levy: ${levyWindow}`);
      return;
    }

    onSave({
      serviceTaxRegistered,
      serviceTax,
      exempt: { n3TaxCodeId: exempt.id, n3TaxCodeSnapshot: exempt.text },
      serviceCharge: { enabled: scEnabled, percentBp: scBp ?? 0, serviceTaxApplies: scTaxed },
      tourismTax: {
        enabled: ttEnabled,
        centsPerRoomNight: ttCents,
        effectiveFrom: orNull(ttFrom),
        effectiveTo: orNull(ttTo),
      },
      localLevy: {
        enabled: levyEnabled,
        label: orNull(levyLabel),
        centsPerRoomNight: levyCents,
        effectiveFrom: orNull(levyFrom),
        effectiveTo: orNull(levyTo),
      },
      rounding: {
        mode: rounding,
        n3RoundingAccountId: roundingAccount.id,
        n3RoundingAccountSnapshot: roundingAccount.text,
      },
    });
  }

  function sectionEnabled(section: TaxSettingsSection): boolean {
    switch (section) {
      case "service_tax":
        return serviceTaxRegistered;
      case "service_charge":
        return scEnabled;
      case "tourism_tax":
        return ttEnabled;
      case "local_levy":
        return levyEnabled;
      case "rounding":
        return rounding !== "none";
    }
  }

  function setSectionEnabled(section: TaxSettingsSection, enabled: boolean) {
    switch (section) {
      case "service_tax":
        setServiceTaxRegistered(enabled);
        break;
      case "service_charge":
        setScEnabled(enabled);
        break;
      case "tourism_tax":
        setTtEnabled(enabled);
        break;
      case "local_levy":
        setLevyEnabled(enabled);
        break;
      case "rounding":
        setRounding(enabled ? (rounding === "none" ? "nearest_5_cents" : rounding) : "none");
        break;
    }
  }

  const activePostingComponent: PostingComponent | null =
    activeSection === "service_charge"
      ? "service_charge"
      : activeSection === "tourism_tax"
        ? "tourism_tax"
        : activeSection === "local_levy"
          ? "local_levy"
          : null;

  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="grid overflow-hidden rounded-lg border md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="border-b bg-slate-50 p-2 md:border-r md:border-b-0">
          <p
            className="px-2 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: NAVY }}
          >
            Tax / charge type
          </p>
          <div className="mt-1 space-y-1">
            {TAX_SETTINGS_SECTIONS.map((section) => {
              const enabled = sectionEnabled(section);
              const selected = section === activeSection;
              return (
                <div
                  key={section}
                  className="flex items-center gap-2 rounded-md border px-2 py-2"
                  style={{
                    borderColor: selected ? `${TEAL}66` : "transparent",
                    backgroundColor: selected ? `${TEAL}12` : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={disabled}
                    aria-label={`${enabled ? "Switch off" : "Switch on"} ${TAX_SETTINGS_SECTION_LABELS[section]}`}
                    onChange={(e) => {
                      setSectionEnabled(section, e.target.checked);
                      setActiveSection(section);
                    }}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setActiveSection(section)}
                  >
                    <span className="block font-medium" style={{ color: NAVY }}>
                      {TAX_SETTINGS_SECTION_LABELS[section]}
                    </span>
                    <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 p-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <h3 className="font-semibold" style={{ color: NAVY }}>
              {TAX_SETTINGS_SECTION_LABELS[activeSection]}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                color: sectionEnabled(activeSection) ? "#0E7C57" : "#6B7280",
                backgroundColor: sectionEnabled(activeSection) ? "#E7F6F3" : "#F3F4F6",
              }}
            >
              {sectionEnabled(activeSection) ? "On" : "Off"}
            </span>
          </div>

          {activeSection === "service_tax" ? (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Map each class to a live N3 Output Tax code. Its N3 rate is used automatically.
              </p>
              {TAXABLE_CLASSES.map((c) => (
                <div key={c} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[11rem_1fr]">
                  <div>
                    <p className="font-medium" style={{ color: NAVY }}>
                      {TAXABLE_CLASS_LABELS[c]}
                    </p>
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      data-testid={`rate-display-${c}`}
                    >
                      {rates[c] === null ? "Rate from N3" : formatRateBpPercent(rates[c])}
                    </p>
                  </div>
                  <N3SelectorField
                    kind="tax_code"
                    label="N3 Tax Code"
                    value={{ id: codes[c].id, code: codes[c].text, name: null, rateBp: rates[c] }}
                    disabled={disabled}
                    onSelect={(row) => {
                      setCodes({ ...codes, [c]: { id: row.id, text: snapshotText(row) } });
                      setRates({
                        ...rates,
                        [c]: typeof row.rateBp === "number" ? row.rateBp : null,
                      });
                    }}
                    onClear={() => {
                      setCodes({ ...codes, [c]: { id: null, text: null } });
                      setRates({ ...rates, [c]: null });
                    }}
                  />
                </div>
              ))}
              <N3SelectorField
                kind="tax_code"
                label="Exempt / out-of-scope N3 Tax Code"
                value={{ id: exempt.id, code: exempt.text, name: null }}
                disabled={disabled}
                onSelect={(row) => setExempt({ id: row.id, text: snapshotText(row) })}
                onClear={() => setExempt({ id: null, text: null })}
              />
            </div>
          ) : null}

          {activeSection === "service_charge" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sc-percent">Percentage</Label>
                <Input
                  id="sc-percent"
                  inputMode="decimal"
                  value={scPercent}
                  disabled={disabled}
                  onChange={(e) => setScPercent(e.target.value)}
                />
              </div>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={scTaxed}
                  disabled={disabled}
                  onChange={(e) => setScTaxed(e.target.checked)}
                />
                Service Tax applies
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                This is the hotel’s commercial charge, not a government tax.
              </p>
            </div>
          ) : null}

          {activeSection === "tourism_tax" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="tt-amount">Per occupied room-night</Label>
                <Input
                  id="tt-amount"
                  inputMode="decimal"
                  value={ttAmount}
                  disabled={disabled}
                  onChange={(e) => setTtAmount(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tt-from">Effective from</Label>
                <MalaysianDateInput
                  id="tt-from"
                  value={ttFrom}
                  disabled={disabled}
                  pickerLabel="Choose Tourism Tax effective-from date"
                  onChange={setTtFrom}
                />
              </div>
              <div>
                <Label htmlFor="tt-to">Effective to</Label>
                <MalaysianDateInput
                  id="tt-to"
                  value={ttTo}
                  disabled={disabled}
                  minIso={ttFrom || undefined}
                  pickerLabel="Choose Tourism Tax effective-to date"
                  onChange={setTtTo}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Guest residency and OTA collection evidence are recorded on the reservation folio.
              </p>
            </div>
          ) : null}

          {activeSection === "local_levy" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label htmlFor="levy-label">Display name</Label>
                <Input
                  id="levy-label"
                  value={levyLabel}
                  disabled={disabled}
                  onChange={(e) => setLevyLabel(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="levy-amount">Per occupied room-night</Label>
                <Input
                  id="levy-amount"
                  inputMode="decimal"
                  value={levyAmount}
                  disabled={disabled}
                  onChange={(e) => setLevyAmount(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="levy-from">Effective from</Label>
                <MalaysianDateInput
                  id="levy-from"
                  value={levyFrom}
                  disabled={disabled}
                  pickerLabel="Choose levy effective-from date"
                  onChange={setLevyFrom}
                />
              </div>
              <div>
                <Label htmlFor="levy-to">Effective to</Label>
                <MalaysianDateInput
                  id="levy-to"
                  value={levyTo}
                  disabled={disabled}
                  minIso={levyFrom || undefined}
                  pickerLabel="Choose levy effective-to date"
                  onChange={setLevyTo}
                />
              </div>
            </div>
          ) : null}

          {activeSection === "rounding" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rounding-mode">Mode</Label>
                <select
                  id="rounding-mode"
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  value={rounding}
                  disabled={disabled}
                  onChange={(e) => setRounding(e.target.value as RoundingMode)}
                >
                  {ROUNDING_MODES.map((m) => (
                    <option key={m} value={m}>
                      {ROUNDING_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              {rounding !== "none" ? (
                <N3SelectorField
                  kind="gl_account"
                  label="N3 rounding account"
                  value={{ code: roundingAccount.text, name: null }}
                  disabled={disabled}
                  onSelect={(row) => setRoundingAccount({ id: row.id, text: snapshotText(row) })}
                  onClear={() => setRoundingAccount({ id: null, text: null })}
                />
              ) : null}
            </div>
          ) : null}

          {activePostingComponent ? (
            <div className="mt-5 border-t pt-4">
              <p className="font-medium" style={{ color: NAVY }}>
                N3 mapping
              </p>
              <PostingMappingFields
                mapping={settings.postingMappings[activePostingComponent]}
                disabled={disabled}
                onPatch={(value) =>
                  onSaveMapping({ postingMappings: { [activePostingComponent]: value } })
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      <Button type="button" disabled={disabled} style={{ backgroundColor: NAVY }} onClick={submit}>
        Save tax settings
      </Button>
    </div>
  );
}
