import { SecurityCashReport } from "./SecurityCashReport";
export function SecurityCashSettings() {
  return (
    <section className="mt-5 rounded-xl border bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Security cash policy and accountant report</h2>
      <SecurityCashReport includePolicy />
    </section>
  );
}
