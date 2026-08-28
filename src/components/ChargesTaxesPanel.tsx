// HH-GOLIVE-01A — Owner-only "Charges & Taxes" workspace.
//
// Two concerns live here: the add-on catalogue (what can be charged, and how
// each item maps to N3 stock / UOM / tax code) and the Malaysian tax and levy
// configuration. Nothing here posts to N3 — the mapping is captured now so
// the later posting milestone has a complete, verified contract.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const NAVY = "#102A43";
const TEAL = "#0F9D8A";

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
        {folioErrorMessage(
          catalogue.error ?? settings.error,
          "Unable to load charges and taxes.",
        )}
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
          until the posting milestone is approved.
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
              disabled={!canManage}
              onToggle={() =>
                saveItem.mutate(
                  { id: item.id, body: { isActive: !item.isActive } },
                  { onError: (err) => toast.error(folioErrorMessage(err)) },
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
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as AddonCategory })
                }
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
                onClick={() =>
                  saveItem.mutate(
                    {
                      body: {
                        displayName: draft.displayName,
                        category: draft.category,
                        taxClass: draft.taxClass,
                        defaultUnitPrice: draft.defaultUnitPrice,
                      },
                    },
                    {
                      onSuccess: () => {
                        setDraft(EMPTY_DRAFT);
                        toast.success("Charge item added.");
                      },
                      onError: (err) => toast.error(folioErrorMessage(err)),
                    },
                  )
                }
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
  onToggle,
}: {
  item: CatalogueItemDTO;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
      <div>
        <p className="font-medium" style={{ color: NAVY }}>
          {item.displayName}
        </p>
        <p className="text-sm text-muted-foreground">
          {ADDON_CATEGORY_LABELS[item.category]} · {TAX_CLASS_LABELS[item.taxClass]}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="rounded px-2 py-0.5 text-sm font-medium"
          style={{
            backgroundColor: item.mappingStatus === "mapped" ? "#E7F6F3" : "#FDF3E7",
            color: NAVY,
          }}
        >
          {item.mappingStatus === "mapped" ? "N3 mapped" : "N3 mapping incomplete"}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onToggle}>
          {item.isActive ? "Switch off" : "Switch on"}
        </Button>
      </div>
    </li>
  );
}

function TaxSettingsForm({
  settings,
  disabled,
  onSave,
}: {
  settings: NonNullable<ReturnType<typeof useChargeSettings>["data"]>["settings"];
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [serviceTax, setServiceTax] = useState(false);
  const [serviceCharge, setServiceCharge] = useState(false);
  const [tourismTax, setTourismTax] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setServiceTax(settings.serviceTax.registered);
    setServiceCharge(settings.serviceCharge.enabled);
    setTourismTax(settings.tourismTax.enabled);
  }, [settings]);

  if (!settings) return null;

  return (
    <div className="mt-4 space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={serviceTax}
          disabled={disabled}
          onChange={(e) => setServiceTax(e.target.checked)}
        />
        Registered for Service Tax
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={serviceCharge}
          disabled={disabled}
          onChange={(e) => setServiceCharge(e.target.checked)}
        />
        Apply a service charge
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={tourismTax}
          disabled={disabled}
          onChange={(e) => setTourismTax(e.target.checked)}
        />
        Collect Tourism Tax for foreign guests
      </label>
      <Button
        type="button"
        disabled={disabled}
        style={{ backgroundColor: NAVY }}
        onClick={() =>
          onSave({
            serviceTax: { registered: serviceTax },
            serviceCharge: { enabled: serviceCharge },
            tourismTax: { enabled: tourismTax },
          })
        }
      >
        Save tax settings
      </Button>
    </div>
  );
}
