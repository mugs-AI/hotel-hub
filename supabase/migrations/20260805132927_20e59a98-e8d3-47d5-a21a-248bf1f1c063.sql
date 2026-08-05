ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS post_check_in_guest_edit_policy text NOT NULL DEFAULT 'contact_only',
  ADD COLUMN IF NOT EXISTS allow_owner_primary_guest_change_after_check_in boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hotel_settings_guest_edit_policy_chk'
  ) THEN
    ALTER TABLE public.hotel_settings
      ADD CONSTRAINT hotel_settings_guest_edit_policy_chk
      CHECK (post_check_in_guest_edit_policy IN ('locked', 'contact_only'));
  END IF;
END
$$;