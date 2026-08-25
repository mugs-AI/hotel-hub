ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS display_size smallint NOT NULL DEFAULT 7;

ALTER TABLE public.hotel_settings
  DROP CONSTRAINT IF EXISTS hotel_settings_display_size_check;

ALTER TABLE public.hotel_settings
  ADD CONSTRAINT hotel_settings_display_size_check CHECK (display_size IN (7, 8, 9));

UPDATE public.hotel_settings SET display_size = 7 WHERE display_size IS NULL;