/** Safe explanations only; never expose the N3 response body or credentials. */
export function paymentAccountErrorMessage(code: string): string {
  switch (code) {
    case "unauthorized":
      return "Your N3 session expired. Relaunch HotelHub from N3 to continue.";
    case "n3_receipt_access_denied":
      return "N3 denied access to Receive Payment defaults. Ask your N3 administrator to check this user's permission.";
    case "n3_account_access_denied":
      return "N3 denied access to bank and cash accounts. Ask your N3 administrator to check this user's permission.";
    case "n3_defaults_currency_missing":
      return "N3 Receive Payment defaults did not include a currency ID. Check this company's currency setup in N3, then retry.";
    case "n3_defaults_currency_invalid":
      return "N3 Receive Payment defaults returned an invalid currency ID. Check this company's currency setup in N3, then retry.";
    case "n3_defaults_currency_conflict":
      return "N3 Receive Payment defaults returned conflicting currency details. Ask your N3 administrator to check this company's currency setup.";
    case "n3_defaults_rejected":
      return "N3 did not return a successful Receive Payment defaults response. Check N3 access for this company, then retry.";
    case "n3_defaults_unavailable":
      return "Could not connect to N3 Receive Payment defaults. Retry the connection.";
    default:
      return "Could not load N3 bank and cash accounts. Retry the connection.";
  }
}
