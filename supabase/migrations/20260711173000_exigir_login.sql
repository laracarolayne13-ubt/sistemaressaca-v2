-- O painel usa Supabase Auth; os dados operacionais não devem permanecer
-- acessíveis pela chave pública sem uma sessão autenticada.
DROP POLICY IF EXISTS "Acesso público à portaria" ON public.encomendas;
DROP POLICY IF EXISTS "Acesso pÃºblico Ã  portaria" ON public.encomendas;
DROP POLICY IF EXISTS "Acesso público à portaria moradores" ON public.moradores;
DROP POLICY IF EXISTS "Acesso pÃºblico Ã  portaria moradores" ON public.moradores;

REVOKE ALL ON public.encomendas FROM anon;
REVOKE ALL ON public.moradores FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.encomendas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moradores TO authenticated;

CREATE POLICY "Usuários autenticados acessam encomendas"
ON public.encomendas FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Usuários autenticados acessam moradores"
ON public.moradores FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Encomendas fotos - leitura pública" ON storage.objects;
DROP POLICY IF EXISTS "Encomendas fotos - upload público" ON storage.objects;
DROP POLICY IF EXISTS "Encomendas fotos - leitura pÃºblica" ON storage.objects;
DROP POLICY IF EXISTS "Encomendas fotos - upload pÃºblico" ON storage.objects;

CREATE POLICY "Encomendas fotos - leitura autenticada"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'encomendas');

CREATE POLICY "Encomendas fotos - upload autenticado"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'encomendas');
