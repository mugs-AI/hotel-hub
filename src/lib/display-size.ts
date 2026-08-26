// Property-wide application display size.
//
// 7 = Current / Compact (default), 8 = Larger, 9 = Largest. These are display
// LEVELS, not literal pixel sizes: each level maps to a root font size, so the
// whole rem-based interface (headings, controls, tables, sheets, navigation)
// scales proportionally and keeps its hierarchy. Font family never changes.
//
// The value is tenant-scoped and Owner-controlled; it is delivered by the
// authoritative session response so every authorised member of staff receives
// the same size. Nothing here reads or writes browser storage.

export type DisplaySize = 7 | 8 | 9;

export const DEFAULT_DISPLAY_SIZE: DisplaySize = 7;

export const DISPLAY_SIZE_OPTIONS: ReadonlyArray<{
  value: DisplaySize;
  label: string;
  hint: string;
}> = [
  { value: 7, label: "7 — Current / Compact", hint: "The established HotelHub density." },
  { value: 8, label: "8 — Larger", hint: "Easier to read across the whole application." },
  { value: 9, label: "9 — Largest", hint: "Maximum readability for shared front-desk screens." },
];

export function isDisplaySize(v: unknown): v is DisplaySize {
  return v === 7 || v === 8 || v === 9;
}

export function coerceDisplaySize(v: unknown): DisplaySize {
  return isDisplaySize(v) ? v : DEFAULT_DISPLAY_SIZE;
}

/** Root font size (px) for a display level. Level 7 is the untouched baseline. */
export function displaySizeRootPx(size: DisplaySize): number {
  switch (size) {
    case 8:
      return 17.5;
    case 9:
      return 19;
    default:
      return 16;
  }
}

/**
 * Apply the property display size to a document. Called whenever the
 * authoritative session value changes, so a confirmed save takes effect on the
 * next session read without a hard refresh or sign-out.
 */
export function applyDisplaySize(doc: Document | undefined, size: DisplaySize): void {
  if (!doc?.documentElement) return;
  doc.documentElement.style.fontSize = `${displaySizeRootPx(size)}px`;
  doc.documentElement.dataset.hotelhubDisplaySize = String(size);
}
