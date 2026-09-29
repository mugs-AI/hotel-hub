/** Property-wide paper typography, independent of HotelHub screen zoom. */
export const FOLIO_BODY_PT = [8, 8.5, 9, 9.5, 10] as const;
export const FOLIO_NOTE_PT = [5, 5.5, 6, 6.5, 7] as const;

export type FolioBodyPt = (typeof FOLIO_BODY_PT)[number];
export type FolioNotePt = (typeof FOLIO_NOTE_PT)[number];

export function isFolioBodyPt(value: unknown): value is FolioBodyPt {
  return FOLIO_BODY_PT.some((size) => size === value);
}

export function isFolioNotePt(value: unknown): value is FolioNotePt {
  return FOLIO_NOTE_PT.some((size) => size === value);
}

export function folioBodyPt(value: unknown): FolioBodyPt {
  return isFolioBodyPt(value) ? value : 8.5;
}

export function folioNotePt(value: unknown): FolioNotePt {
  return isFolioNotePt(value) ? value : 5;
}
