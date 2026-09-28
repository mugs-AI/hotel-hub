/** Only an actual name belongs in the visible header. Email stays in [i]. */
export function humanDisplayName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name || name.includes("@")) return null;
  return name.slice(0, 200);
}
