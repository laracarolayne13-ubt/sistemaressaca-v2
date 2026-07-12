
CREATE POLICY "Encomendas fotos - leitura pública"
ON storage.objects FOR SELECT
USING (bucket_id = 'encomendas');

CREATE POLICY "Encomendas fotos - upload público"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'encomendas');
