ALTER TABLE public.encomendas
  ADD COLUMN porteiro_responsavel text;

CREATE TABLE public.porteiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.porteiros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Porteiros podem ser lidos por autenticados"
ON public.porteiros FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Somente admins gerenciam porteiros"
ON public.porteiros FOR ALL
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE INDEX idx_porteiros_ativos_nome ON public.porteiros (ativo, nome);
