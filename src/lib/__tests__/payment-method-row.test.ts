import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentMethodRow } from "@/components/PaymentMethodRow";
import { shownPaymentAccounts } from "@/lib/deposits-client";
import { paymentAccountErrorMessage } from "@/lib/payment-account-messages";
const account = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "700-0310",
  name: "Bank",
  kind: "bank" as const,
  label: "QR",
  show: true,
};
describe("payment method controls", () => {
  it.each([true, false])("renders the Show checkbox with saved state %s", (show) => {
    const html = renderToStaticMarkup(
      createElement(PaymentMethodRow, {
        account,
        label: "QR",
        show,
        saving: false,
        disabled: false,
        onLabelChange: () => {},
        onShowChange: () => {},
        onSave: () => {},
      }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html.includes('checked=""')).toBe(show);
    expect(html).toContain("Show");
    expect(html).toContain("Save method");
    expect(html).toContain("700-0310");
  });
  it("wires a checkbox change and Save independently", () => {
    const onShowChange = vi.fn();
    const onSave = vi.fn();
    const row = PaymentMethodRow({
      account,
      label: "QR",
      show: true,
      saving: false,
      disabled: false,
      onLabelChange: () => {},
      onShowChange,
      onSave,
    });
    const children = row.props.children;
    children[1].props.children[0].props.onChange({ target: { checked: false } });
    expect(onShowChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
    children[2].props.onClick();
    expect(onSave).toHaveBeenCalledOnce();
  });
  it("removes hidden accounts only from new-payment choices", () => {
    const hidden = { ...account, id: "hidden", show: false };
    const data = { accounts: [hidden, account] };
    expect(shownPaymentAccounts(data)).toEqual({ accounts: [account] });
    expect(data.accounts).toHaveLength(2);
  });
  it("explains missing currency separately from transport and permission failures", () => {
    expect(paymentAccountErrorMessage("n3_defaults_currency_missing")).toContain("currency ID");
    expect(paymentAccountErrorMessage("n3_defaults_rejected")).toContain("successful");
    expect(paymentAccountErrorMessage("n3_defaults_currency_conflict")).toContain("conflicting");
    expect(paymentAccountErrorMessage("n3_receipt_access_denied")).toContain("permission");
  });
});
