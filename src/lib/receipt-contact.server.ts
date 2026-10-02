import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DepositError } from "./deposits-store.server";

import { formatReceiptContact, ReceiptContactError } from "./receipt-contact";
import type { ReceiptContactFields } from "./receipt-contact";

export type ReceiptContact = ReceiptContactFields;

/** Saved bill-to details belong to this booking; never update the N3 customer master. */
export async function readReceiptContact(
  tenantId: string,
  reservationId: string,
): Promise<ReceiptContact> {
  const saved = await supabaseAdmin
    .from("hotel_folio_bill_to")
    .select("name, company, address, phone, email")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (saved.error) throw new DepositError("receipt_contact_unavailable");
  let details = saved.data;
  if (!details) {
    const link = await supabaseAdmin
      .from("hotel_reservation_guests")
      .select("guest_id")
      .eq("tenant_id", tenantId)
      .eq("reservation_id", reservationId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (link.error || !link.data) throw new DepositError("receipt_contact_unavailable");
    const guest = await supabaseAdmin
      .from("hotel_guests")
      .select(
        "full_name, mobile, email, address_line_1, address_line_2, address_line_3, postcode, city, state_province, state_code, country_code",
      )
      .eq("tenant_id", tenantId)
      .eq("id", link.data.guest_id)
      .maybeSingle();
    if (guest.error || !guest.data) throw new DepositError("receipt_contact_unavailable");
    const g = guest.data;
    details = {
      name: g.full_name,
      company: "",
      phone: g.mobile ?? "",
      email: g.email ?? "",
      address: [
        g.address_line_1,
        g.address_line_2,
        g.address_line_3,
        [g.postcode, g.city].filter(Boolean).join(" "),
        g.state_province || g.state_code,
        g.country_code,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  try {
    return formatReceiptContact(details);
  } catch (e) {
    if (e instanceof ReceiptContactError) throw new DepositError(e.code);
    throw e;
  }
}
