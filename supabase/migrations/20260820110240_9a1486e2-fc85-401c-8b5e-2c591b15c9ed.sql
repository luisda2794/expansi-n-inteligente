CREATE TABLE public.zip_geocodes (
  zip_code text PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zip_geocodes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zip_geocodes TO authenticated;
GRANT ALL ON public.zip_geocodes TO service_role;
ALTER TABLE public.zip_geocodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY zip_geocodes_public_all ON public.zip_geocodes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);