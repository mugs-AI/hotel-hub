ALTER TABLE public.hotel_settings
  ALTER COLUMN post_check_in_guest_edit_policy SET DEFAULT 'locked';

ALTER TABLE public.hotel_settings
  ALTER COLUMN allow_owner_primary_guest_change_after_check_in SET DEFAULT false;

UPDATE public.hotel_settings
   SET post_check_in_guest_edit_policy = 'locked',
       updated_at = now()
 WHERE post_check_in_guest_edit_policy = 'contact_only';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hotel_settings'::regclass
      AND conname = 'hotel_settings_post_check_in_guest_edit_policy_check'
  ) THEN
    ALTER TABLE public.hotel_settings
      ADD CONSTRAINT hotel_settings_post_check_in_guest_edit_policy_check
      CHECK (post_check_in_guest_edit_policy IN ('locked','contact_only'));
  END IF;
END $$;