CREATE TABLE public.moradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade text NOT NULL UNIQUE,
  nome text NOT NULL,
  whatsapp text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moradores TO anon, authenticated;
GRANT ALL ON public.moradores TO service_role;

ALTER TABLE public.moradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso público à portaria moradores"
ON public.moradores FOR ALL
USING (true) WITH CHECK (true);

CREATE INDEX idx_moradores_unidade ON public.moradores(unidade);