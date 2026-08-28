// HH-GOLIVE-01A — Owner-only "Charges & Taxes" workspace.
//
// Two concerns live here: the add-on catalogue (what can be charged, and how
// each item maps to N3 stock / UOM / tax code) and the Malaysian tax and levy
// configuration. Nothing here posts to N3 — the mapping is captured now so
// the later posting milestone has a complete, verified contract.
//
// Deliberate: no rate is ever defaulted or auto-applied. Malaysian figures are
// shown as non-binding suggestions the Owner must accept explicitly, because a
// guessed tax rate is a legal problem, not a convenience.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { N3Picker } from "@/components/N3Picker";
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
import {
  SUGGESTED_ACCOMMODATION_RATE_BP,
  SUGGESTED_FNB_RATE_BP,
  SUGGESTED_PARKING_RATE_BP,
  SUGGESTED_TOURISM_TAX_CENTS,
  type FinancialSettings,
  type TaxableClass,
} from "@/lib/financial-settings";
import { ROUNDING_MODES, type RoundingMode } from "@/lib/folio-money";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";

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

const SUGGESTED_BP: Record<TaxableClass, number> = {
  accommodation: SUGGESTED_ACCOMMODATION_RATE_BP,
  food_and_beverage: SUGGESTED_FNB_RATE_BP,
  parking: SUGGESTED_PARKING_RATE_BP,
  other_taxable_service: SUGGESTED_FNB_RATE_BP,
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
      <p className="text-sm" style={{ color: "#C2413B" }}>
        {folioErrorMessage(catalogue.error ?? settings.error, "Unable to load charges and taxes.")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section
        className="rounded-xl border bg-white p-5 shadow-sm"
        style={{ borderColor: `${NAVY}1F` }}
      >
        <h2 className="text-base font-semibold" style={{ color: NAVY }}>
          Malaysian taxes and levies
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          These settings decide how HotelHub totals a folio. Nothing is submitted to accounting
          until the posting milestone is approved. No rate is applied until you set it here.
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
          An item can only be charged once its N3 stock, unit of measure and tax code are mapped.
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
  const [uomId, setUomId] = useState(item.n3UomId ?? "");
  const [taxCodeId, setTaxCodeId] = useState(item.n3TaxCodeId ?? "");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setPrice(centsToText(item.defaultUnitPriceCents));
    setUomId(item.n3UomId ?? "");
    setTaxCodeId(item.n3TaxCodeId ?? "");
  }, [item.defaultUnitPriceCents, item.n3UomId, item.n3TaxCodeId]);

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
            N3 stock: {item.n3StockCodeSnapshot ?? "not mapped"}
            {item.n3StockNameSnapshot ? ` — ${item.n3StockNameSnapshot}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="rounded px-2 py-0.5 text-sm font-medium"
            style={{ backgroundColor: mapped ? "#E7F6F3" : "#FDF3E7", color: NAVY }}
          >
            {mapped ? "N3 mapped" : "N3 mapping incomplete"}
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
            <div>
              <Label htmlFor={`uom-${item.id}`}>N3 unit of measure id</Label>
              <Input
                id={`uom-${item.id}`}
                value={uomId}
                disabled={disabled}
                onChange={(e) => setUomId(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`taxcode-${item.id}`}>N3 tax code id</Label>
              <Input
                id={`taxcode-${item.id}`}
                value={taxCodeId}
                disabled={disabled}
                onChange={(e) => setTaxCodeId(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setPicking((v) => !v)}
            >
              {picking ? "Cancel stock pick" : "Pick N3 stock"}
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
                onSave({
                  defaultUnitPriceCents: cents,
                  n3UomId: orNull(uomId),
                  n3UomSnapshot: orNull(uomId),
                  n3TaxCodeId: orNull(taxCodeId),
                  n3TaxCodeSnapshot: orNull(taxCodeId),
                });
              }}
            >
              Save mapping
            </Button>
          </div>

          {picking ? (
            <div className="rounded-md border p-3">
              <N3Picker
                kind="stocks"
                onPick={(row) => {
                  setPicking(false);
                  onSave({
                    n3StockId: row.id,
                    n3StockCodeSnapshot: row.code,
                    n3StockNameSnapshot: row.name ?? row.code,
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

function TaxSettingsForm({
  settings,
  disabled,
  onSave,
}: {
  settings: FinancialSettings;
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [serviceTaxRegistered, setServiceTaxRegistered] = useState(false);
  const [rates, setRates] = useState<Record<TaxableClass, string>>({
    accommodation: "",
    food_and_beverage: "",
    parking: "",
    other_taxable_service: "",
  });
  const [codes, setCodes] = useState<Record<TaxableClass, string>>({
    accommodation: "",
    food_and_beverage: "",
    parking: "",
    other_taxable_service: "",
  });
  const [exemptCode, setExemptCode] = useState("");
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
  const [roundingAccount, setRoundingAccount] = useState("");

  useEffect(() => {
    setServiceTaxRegistered(settings.serviceTaxRegistered);
    setRates({
      accommodation: bpToPercentText(settings.serviceTax.accommodation.rateBp),
      food_and_beverage: bpToPercentText(settings.serviceTax.food_and_beverage.rateBp),
      parking: bpToPercentText(settings.serviceTax.parking.rateBp),
      other_taxable_service: bpToPercentText(settings.serviceTax.other_taxable_service.rateBp),
    });
    setCodes({
      accommodation: settings.serviceTax.accommodation.n3TaxCodeId ?? "",
      food_and_beverage: settings.serviceTax.food_and_beverage.n3TaxCodeId ?? "",
      parking: settings.serviceTax.parking.n3TaxCodeId ?? "",
      other_taxable_service: settings.serviceTax.other_taxable_service.n3TaxCodeId ?? "",
    });
    setExemptCode(settings.exempt.n3TaxCodeId ?? "");
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
    setRoundingAccount(settings.rounding.n3RoundingAccountId ?? "");
  }, [settings]);

  function submit() {
    const serviceTax: Record<string, unknown> = {};
    for (const c of TAXABLE_CLASSES) {
      const bp = percentTextToBp(rates[c]);
      if (bp === undefined) {
        toast.error(`Enter a valid ${TAXABLE_CLASS_LABELS[c]} Service Tax rate.`);
        return;
      }
      serviceTax[c] = {
        rateBp: bp,
        n3TaxCodeId: orNull(codes[c]),
        n3TaxCodeSnapshot: orNull(codes[c]),
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

    onSave({
      serviceTaxRegistered,
      serviceTax,
      exempt: { n3TaxCodeId: orNull(exemptCode), n3TaxCodeSnapshot: orNull(exemptCode) },
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
        n3RoundingAccountId: orNull(roundingAccount),
        n3RoundingAccountSnapshot: orNull(roundingAccount),
      },
    });
  }

  return (
    <div className="mt-4 space-y-5 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={serviceTaxRegistered}
          disabled={disabled}
          onChange={(e) => setServiceTaxRegistered(e.target.checked)}
        />
        This property is registered for Service Tax
      </label>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
          Service Tax by class
        </legend>
        <p className="text-sm text-muted-foreground">
          Leave a rate blank if it is not configured — HotelHub will block the folio rather than
          guess.
        </p>
        <div className="mt-3 space-y-3">
          {TAXABLE_CLASSES.map((c) => (
            <div key={c} className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor={`rate-${c}`}>{TAXABLE_CLASS_LABELS[c]} rate %</Label>
                <Input
                  id={`rate-${c}`}
                  inputMode="decimal"
                  value={rates[c]}
                  disabled={disabled}
                  onChange={(e) => setRates({ ...rates, [c]: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`code-${c}`}>N3 tax code id</Label>
                <Input
                  id={`code-${c}`}
                  value={codes[c]}
                  disabled={disabled}
                  onChange={(e) => setCodes({ ...codes, [c]: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    setRates({ ...rates, [c]: bpToPercentText(SUGGESTED_BP[c]) })
                  }
                >
                  Use suggested {SUGGESTED_BP[c] / 100}%
                </Button>
              </div>
            </div>
          ))}
          <div className="sm:w-1/3">
            <Label htmlFor="exempt-code">Exempt N3 tax code id</Label>
            <Input
              id="exempt-code"
              value={exemptCode}
              disabled={disabled}
              onChange={(e) => setExemptCode(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
          Service charge (commercial, not a government tax)
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={scEnabled}
            disabled={disabled}
            onChange={(e) => setScEnabled(e.target.checked)}
          />
          Apply a service charge
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
            Service Tax applies to the service charge
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
          Tourism Tax (foreign guests)
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ttEnabled}
            disabled={disabled}
            onChange={(e) => setTtEnabled(e.target.checked)}
          />
          Collect Tourism Tax
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div>
            <Label htmlFor="tt-amount">Per occupied room-night</Label>
            <Input
              id="tt-amount"
              inputMode="decimal"
              value={ttAmount}
              disabled={disabled}
              onChange={(e) => setTtAmount(e.target.value)}
            />
            <button
              type="button"
              className="mt-1 text-sm underline underline-offset-2"
              disabled={disabled}
              onClick={() => setTtAmount(centsToText(SUGGESTED_TOURISM_TAX_CENTS))}
            >
              Use suggested {centsToText(SUGGESTED_TOURISM_TAX_CENTS)}
            </button>
          </div>
          <div>
            <Label htmlFor="tt-from">Effective from</Label>
            <Input
              id="tt-from"
              type="date"
              value={ttFrom}
              disabled={disabled}
              onChange={(e) => setTtFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tt-to">Effective to</Label>
            <Input
              id="tt-to"
              type="date"
              value={ttTo}
              disabled={disabled}
              onChange={(e) => setTtTo(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
          State / local levy
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={levyEnabled}
            disabled={disabled}
            onChange={(e) => setLevyEnabled(e.target.checked)}
          />
          Apply a local levy
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <div>
            <Label htmlFor="levy-label">Levy name on the folio</Label>
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
            <Input
              id="levy-from"
              type="date"
              value={levyFrom}
              disabled={disabled}
              onChange={(e) => setLevyFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="levy-to">Effective to</Label>
            <Input
              id="levy-to"
              type="date"
              value={levyTo}
              disabled={disabled}
              onChange={(e) => setLevyTo(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold" style={{ color: NAVY }}>
          Rounding
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
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
          <div>
            <Label htmlFor="rounding-account">N3 rounding account id</Label>
            <Input
              id="rounding-account"
              value={roundingAccount}
              disabled={disabled}
              onChange={(e) => setRoundingAccount(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <Button type="button" disabled={disabled} style={{ backgroundColor: NAVY }} onClick={submit}>
        Save tax settings
      </Button>
    </div>
  );
}
