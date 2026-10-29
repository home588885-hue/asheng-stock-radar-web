-- Prospective, public-market research ONLY. No holdings, scores or paid scans.
CREATE TABLE IF NOT EXISTS public.asheng_sector_intraday_observations (
  bucket_start timestamptz PRIMARY KEY,
  market_date date NOT NULL,
  model_as_of date NOT NULL,
  observed_at timestamptz NOT NULL,
  selected_count integer NOT NULL CHECK (selected_count BETWEEN 0 AND 120),
  valid_count integer NOT NULL CHECK (valid_count BETWEEN 0 AND selected_count),
  source text NOT NULL DEFAULT 'TWSE MIS valid trades',
  observation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asheng_sector_intraday_observations_market_date_idx
 ON public.asheng_sector_intraday_observations (market_date DESC, observed_at DESC);
ALTER TABLE public.asheng_sector_intraday_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asheng_sector_intraday_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.asheng_sector_intraday_observations TO service_role;
-- No public/member policy. Authenticated clients never read or write raw intraday research.
-- Future study must pair these precommitted snapshots with LATER EOD outcomes and costs.
