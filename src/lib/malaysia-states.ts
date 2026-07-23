// Controlled Malaysian state reference data.
// Codes are STRINGS so leading zeroes are preserved.

export type MalaysianState = { code: string; name: string };

export const MALAYSIAN_STATES: readonly MalaysianState[] = [
  { code: "01", name: "Johor" },
  { code: "02", name: "Kedah" },
  { code: "03", name: "Kelantan" },
  { code: "04", name: "Melaka" },
  { code: "05", name: "Negeri Sembilan" },
  { code: "06", name: "Pahang" },
  { code: "07", name: "Pulau Pinang" },
  { code: "08", name: "Perak" },
  { code: "09", name: "Perlis" },
  { code: "10", name: "Selangor" },
  { code: "11", name: "Terengganu" },
  { code: "12", name: "Sabah" },
  { code: "13", name: "Sarawak" },
  { code: "14", name: "W.P. Kuala Lumpur" },
  { code: "15", name: "W.P. Labuan" },
  { code: "16", name: "W.P. Putrajaya" },
] as const;

const BY_CODE: Map<string, MalaysianState> = new Map(MALAYSIAN_STATES.map((s) => [s.code, s]));

export function isValidMalaysianStateCode(v: unknown): v is string {
  return typeof v === "string" && BY_CODE.has(v);
}

export function malaysianStateName(code: string | null | undefined): string {
  if (!code) return "";
  return BY_CODE.get(code)?.name ?? "";
}
