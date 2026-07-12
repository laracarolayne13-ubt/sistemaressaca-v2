
CREATE TABLE public.encomendas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo TEXT NOT NULL,
  unidade TEXT NOT NULL,
  logradouro TEXT NOT NULL,
  empresa TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Normal',
  foto_url TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  recebedor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entregue_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.encomendas TO anon, authenticated;
GRANT ALL ON public.encomendas TO service_role;

ALTER TABLE public.encomendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso público à portaria" ON public.encomendas
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_encomendas_status ON public.encomendas(status, created_at DESC);
