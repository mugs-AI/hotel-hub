// Browser-side shared helpers for hotel settings and N3 lookup rows.
// Same-origin, cookie-authenticated; never talks to Supabase or N3 directly.

export type HotelSettingsDTO = {
  tenantId: string;
  currency: string;
  timezone: string;
  standardCheckInTime: string;
  standardCheckOutTime: string;
  postCheckInGuestEditPolicy: "locked" | "contact_only";
  allowOwnerPrimaryGuestChangeAfterCheckIn: boolean;
  housekeepingMode: "simple" | "dedicated";
  exceptionApprovalMode: "owner_approval" | "direct";
  walkInCustomer: { n3Id: string; n3Code: string; n3Name: string | null } | null;
};

export type N3CustomerRow = { id: string; code: string; name: string | null };
export type N3StockRow = {
  id: string;
  code: string;
  name: string | null;
  isActive: boolean | null;
};

export async function hotelJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body;
}
