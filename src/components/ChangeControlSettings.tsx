import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { defaultChangePolicy, type ChangePolicy } from "@/lib/hotel-change-controls";
import {
  changePolicyKey,
  useChangePolicy,
  saveChangePolicy,
} from "@/lib/hotel-change-controls-client";
import { useReceiptIdentity, invalidateReceiptEffects } from "@/lib/receipt-controls-client";
export function ChangeControlOptions({
  policy,
  available,
  owner,
  busy,
  onChange,
}: {
  policy: ChangePolicy;
  available: boolean;
  owner: boolean;
  busy?: boolean;
  onChange: (next: ChangePolicy) => void;
}) {
  return (
    <section
      aria-label="Deposit and billing contact approvals"
      className="rounded-lg border bg-white p-4"
    >
      <h3 className="font-semibold">Deposit and billing contact approvals</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["depositApprovalRequired", "Deposit changes require Admin approval"],
            ["contactApprovalRequired", "Billing contact changes require Admin approval"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={policy[key]}
              disabled={!available || !owner || busy}
              onChange={(e) => onChange({ ...policy, [key]: e.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Admin means Owner. With deposit approval off, an Owner can apply the change directly;
        front-desk N3 changes still need an Owner to apply. Billing contact approval controls both
        local folio details and selected receipt contact changes.
      </p>
      {!available ? (
        <p role="status" className="mt-2 text-sm text-amber-900">
          Change controls are not installed or could not be read. These switches are unavailable.
        </p>
      ) : null}
    </section>
  );
}
export function ChangeControlSettings() {
  const identity = useReceiptIdentity(),
    current = useRef(identity);
  current.current = identity;
  const q = useChangePolicy(),
    qc = useQueryClient();
  const save = useMutation({
    mutationKey: ["hotel-change-policy", identity ?? "none", "save"],
    mutationFn: (p: ChangePolicy) =>
      saveChangePolicy({
        expectedRevision: p.revision,
        depositApprovalRequired: p.depositApprovalRequired,
        contactApprovalRequired: p.contactApprovalRequired,
      }),
    onSuccess: (policy) => {
      if (current.current !== identity || !identity) return;
      qc.setQueryData(changePolicyKey(identity), { available: true, policy });
      invalidateReceiptEffects(qc);
    },
  });
  return (
    <div className="space-y-2">
      <ChangeControlOptions
        policy={q.policy ?? defaultChangePolicy()}
        available={q.available}
        owner={identity?.endsWith(":owner") === true}
        busy={save.isPending}
        onChange={(p) => save.mutate(p)}
      />
      {save.error && current.current === identity ? (
        <p role="alert" className="text-sm text-red-700">
          Could not save controls. Refresh the settings before trying again.
        </p>
      ) : null}
    </div>
  );
}
