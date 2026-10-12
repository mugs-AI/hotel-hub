export type SafeDocumentRefs = {
  bookingReference: string;
  documents: Array<{ id: string; code: string }>;
};
const guidance = [
  [
    /unauthorized|session_expired|scope_lost/,
    "Reopen HotelHub through N3, then check the same saved attempt.",
  ],
  [/forbidden|permission/, "Ask the authorized Owner or accountant to review N3 permissions."],
  [
    /scope|identity|customer|currency|unowned|duplicate/,
    "Confirm this booking and its exact saved documents with the Owner; do not rebind another receipt.",
  ],
  [
    /inactive|unapproved|draft|cancel|void|bounced/,
    "Ask the accountant to review the actual N3 document status, then check the same document.",
  ],
  [
    /insufficient|allocation_mismatch|used_elsewhere/,
    "Ask the accountant to review all existing matches in N3; do not clear other allocations.",
  ],
  [
    /already_paid|no_remaining/,
    "Check the existing matching and verified settlement; do not create another balance receipt.",
  ],
  [
    /refund|surplus|remainder/,
    "Keep an accountant review case open. The N3 accountant handles its accounting treatment; the guest bill still needs settled proof.",
  ],
  [
    /journal|gl_|evidence_unavailable|verification_(waiting|deadline|cancelled)/,
    "Waiting for verification. Check the same saved documents again; a missing journal does not prove the action failed.",
  ],
  [
    /stale|concurrent|fingerprint/,
    "Refresh the exact N3 facts and ask the accountant to use N3 matching; do not repeat an allocation update.",
  ],
  [
    /mapping|contract|account|tax|stock|period|configuration/,
    "Ask the accountant or admin to review N3 configuration and the accepted document contract before proceeding.",
  ],
  [
    /freeze|revision|busy|pending|attempt/,
    "Recover the existing saved intent and attempt; do not create another reference.",
  ],
  [
    /timeout|network|malformed|too_large|business|unavailable|other/,
    "Other N3 error. Review the existing document in N3, then check its saved result here.",
  ],
] as const;
export function recoveryMessage(
  code: string,
  phase: "before_dispatch" | "after_dispatch",
  refs: SafeDocumentRefs,
): string {
  const safe = (v: string) => (/^[\w ./-]{1,80}$/.test(v) ? v : "saved document");
  const names = refs.documents
    .slice(0, 12)
    .map((d) => safe(d.code))
    .join(", ");
  const prefix =
    phase === "after_dispatch"
      ? "N3 has not confirmed the saved action; do not collect again."
      : "This request was not sent to N3.";
  const instruction = guidance.find(([pattern]) => pattern.test(code))?.[1] ?? guidance[11][1];
  return `${prefix} ${instruction} ${safe(refs.bookingReference)}${names ? ` / ${names}` : ""}.`;
}
