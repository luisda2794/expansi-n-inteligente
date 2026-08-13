
CREATE TABLE public.epod_daily (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zip_code TEXT NOT NULL,
  dsp_name TEXT NOT NULL DEFAULT 'Desconocido',
  task_date DATE NOT NULL,
  parcels INTEGER NOT NULL DEFAULT 0,
  locality TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zip_code, dsp_name, task_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.epod_daily TO anon, authenticated;
GRANT ALL ON public.epod_daily TO service_role;
ALTER TABLE public.epod_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "epod_daily_public_all" ON public.epod_daily FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.expansion_zips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zip_code TEXT NOT NULL,
  locality TEXT,
  estimated_daily_volume NUMERIC NOT NULL DEFAULT 0,
  current_company TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expansion_zips TO anon, authenticated;
GRANT ALL ON public.expansion_zips TO service_role;
ALTER TABLE public.expansion_zips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expansion_zips_public_all" ON public.expansion_zips FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_epod_daily_updated BEFORE UPDATE ON public.epod_daily FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_expansion_zips_updated BEFORE UPDATE ON public.expansion_zips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
