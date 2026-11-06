-- TALENTAI | Fase 7A / RAG vectorial | SOLO LECTURA
-- Verificar tipo, extensión y estado de los documentos existentes antes de migrar.
SELECT '01_EXTENSION' AS seccion, jsonb_build_object(
  'vector_extension', (SELECT extname FROM pg_extension WHERE extname='vector'),
  'vector_schema', (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'),
  'vector_version', (SELECT extversion FROM pg_extension WHERE extname='vector')
) AS resultado
UNION ALL
SELECT '02_DOCUMENTOS', jsonb_build_object(
  'total',count(*), 'texto_vacio',count(*) FILTER (WHERE nullif(btrim(contenido_texto),'') IS NULL),
  'caracteres_totales',coalesce(sum(length(contenido_texto)),0),
  'mayor_documento_caracteres',coalesce(max(length(contenido_texto)),0))
FROM public.base_conocimiento
UNION ALL
SELECT '03_ESTRUCTURA',coalesce(jsonb_agg(jsonb_build_object('columna',column_name,'tipo',data_type,'udt',udt_name)), '[]'::jsonb)
FROM information_schema.columns
WHERE table_schema='public' AND table_name='base_conocimiento'
UNION ALL
SELECT '04_RLS',jsonb_build_object('base_conocimiento_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.base_conocimiento'::regclass));
