import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Wallet } from "lucide-react";
import { Button } from "./ui/button";
import { CardHeading } from "./CardInfoPopover";
import { hotelJson } from "@/lib/hotel-settings-client";
import type { DepositModulePolicyState } from "@/lib/deposit-module-policy";
import {
  identityFromSession,
  receiptIdentityKey,
  purgeSensitiveReceiptData,
} from "@/lib/receipt-controls-client";
import { useSessionMe, SESSION_QUERY_KEY } from "@/lib/session-client";

const URL = "/api/hotel/deposit-modules";
type Feedback = { error: boolean; text: string } | null;

export function DepositModuleControls({
  state,
  onChange,
  disabled,
}: {
  state: DepositModulePolicyState;
  onChange: (field: "roomAdvanceEnabled" | "securityDepositEnabled", value: boolean) => void;
  disabled: boolean;
}) {
  const modules = [
    {
      key: "roomAdvanceEnabled" as const,
      title: "Room Advance Payments",
      Icon: Wallet,
      detail: "Payments towards the guest’s bill, recorded in N3.",
      color: "border-teal-200 bg-teal-50",
      unavailable: false,
    },
    {
      key: "securityDepositEnabled" as const,
      title: "Refundable Security Deposits",
      Icon: Banknote,
      detail: "Cash held separately and returned after inspection.",
      color: "border-amber-200 bg-amber-50",
      unavailable: !state.securityReady,
    },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {modules.map(({ key, title, Icon, detail, color, unavailable }) => (
          <label key={key} className={`flex items-start gap-3 rounded-xl border p-4 ${color}`}>
            <Icon className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[#102A43]">{title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
              {unavailable ? (
                <span className="mt-2 block text-xs font-medium text-amber-800">
                  Security cash collection is not available yet.
                </span>
              ) : null}
            </span>
            <input
              aria-label={title}
              role="switch"
              type="checkbox"
              checked={state.policy[key]}
              disabled={disabled || !state.available || unavailable}
              onChange={(event) => onChange(key, event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-teal-700"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Enable either module, both, or neither when available. Checkout payments remain available.
      </p>
      <p className="text-xs text-muted-foreground">
        Turning a module off stops new collections. Existing records can still be settled or
        returned. Payments already requested may finish.
      </p>
    </div>
  );
}

function DepositModuleEditor({
  state,
  onSaved,
  onConflict,
  identity,
  isCurrent,
  onFeedback,
}: {
  state: DepositModulePolicyState;
  onSaved: (next: DepositModulePolicyState) => void;
  onConflict: () => Promise<unknown>;
  identity: string;
  isCurrent: () => boolean;
  onFeedback: (feedback: Feedback) => void;
}) {
  const [policy, setPolicy] = useState(state.policy);
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const changed =
    policy.roomAdvanceEnabled !== state.policy.roomAdvanceEnabled ||
    policy.securityDepositEnabled !== state.policy.securityDepositEnabled;
  async function save() {
    if (!isCurrent()) return;
    setSaving(true);
    onFeedback(null);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const next = await hotelJson<DepositModulePolicyState>(URL, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-hotelhub-expected-identity": identity },
        body: JSON.stringify(policy),
        signal: controller.signal,
      });
      if (!isCurrent() || controller.signal.aborted) return;
      onSaved(next);
      onFeedback({ error: false, text: "Deposit settings saved." });
    } catch (cause) {
      if (!isCurrent() || controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : "";
      if (code === "deposit_module_policy_conflict") {
        onFeedback({
          error: true,
          text: "Another Owner changed these settings. Reloaded the latest values; review and save again.",
        });
        await onConflict().catch(() => {});
      } else
        onFeedback({
          error: true,
          text:
            code === "security_deposit_unavailable"
              ? "Security cash collection is not available yet."
              : code === "deposit_module_identity_changed"
                ? "Your property session changed. Reload before saving deposit settings."
                : "Unable to save deposit settings. Please reload and try again.",
        });
    } finally {
      if (isCurrent() && !controller.signal.aborted) setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <DepositModuleControls
        state={{ ...state, policy }}
        disabled={saving}
        onChange={(field, value) => {
          setPolicy((current) => ({ ...current, [field]: value }));
          onFeedback(null);
        }}
      />
      {!state.available ? (
        <p className="text-sm text-amber-800">
          Deposit settings are being prepared. Current room payments continue.
        </p>
      ) : null}
      <Button onClick={() => void save()} disabled={!state.available || saving || !changed}>
        {saving ? "Saving…" : "Save deposit settings"}
      </Button>
    </div>
  );
}

export function DepositModuleSettingsPanel() {
  const me = useSessionMe();
  const identity = identityFromSession(me);
  if (!identity || !me.data || me.data.authenticated === false || me.data.role !== "owner")
    return null;
  return <DepositModuleSettingsBody key={identity} identity={identity} />;
}

function DepositModuleSettingsBody({ identity }: { identity: string }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const policyKey = ["deposit-module-policy", identity] as const;
  const isCurrent = () =>
    receiptIdentityKey(queryClient.getQueryData(SESSION_QUERY_KEY)) === identity;
  useEffect(() => {
    purgeSensitiveReceiptData(queryClient, identity);
  }, [queryClient, identity]);
  const query = useQuery({
    queryKey: policyKey,
    queryFn: ({ signal }) => hotelJson<DepositModulePolicyState>(URL, { signal }),
    retry: false,
  });
  return (
    <section
      aria-label="Deposit modules"
      className="rounded-xl border bg-white p-4 shadow-sm sm:p-5"
    >
      <CardHeading title="Deposit modules">
        Choose new collection types. Room advance payments and security cash use separate records
        and receipts.
      </CardHeading>
      <div className="mt-4">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading deposit settings…</p>
        ) : query.isError || !query.data ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-700">
              Unable to load deposit settings.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Reload
            </Button>
          </div>
        ) : (
          <DepositModuleEditor
            key={query.data.policy.version}
            identity={identity}
            isCurrent={isCurrent}
            state={query.data}
            onFeedback={(next) => {
              if (isCurrent()) setFeedback(next);
            }}
            onConflict={() => query.refetch()}
            onSaved={(next) => {
              if (!isCurrent()) return;
              queryClient.setQueryData(policyKey, next);
              void queryClient.invalidateQueries({ queryKey: ["deposits"] });
            }}
          />
        )}
        {feedback ? (
          <p
            role={feedback.error ? "alert" : "status"}
            className={`mt-3 text-sm ${feedback.error ? "text-red-700" : "text-teal-700"}`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
