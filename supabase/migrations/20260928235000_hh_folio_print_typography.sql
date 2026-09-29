-- Apply before deploying the matching folio print Settings release.
-- Existing properties get the invoice-style defaults; no financial data changes.
alter table public.hotel_settings
  add column if not exists folio_body_pt numeric(3,1) not null default 8.5,
  add column if not exists folio_note_pt numeric(3,1) not null default 5.0,
  add column if not exists folio_contact_address text not null default '',
  add column if not exists folio_contact_phone text not null default '',
  add column if not exists folio_contact_email text not null default '';

alter table public.hotel_settings
  add constraint hotel_settings_folio_body_pt_allowed
    check (folio_body_pt in (8, 8.5, 9, 9.5, 10)),
  add constraint hotel_settings_folio_note_pt_allowed
    check (folio_note_pt in (5, 5.5, 6, 6.5, 7)),
  add constraint hotel_settings_folio_contact_length
    check (length(folio_contact_address) <= 500 and length(folio_contact_phone) <= 60 and length(folio_contact_email) <= 254);
