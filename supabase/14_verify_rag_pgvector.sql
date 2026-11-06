-- Fase 7A - VERIFICACIÓN. Ejecutar DESPUÉS de migración e indexación.
SELECT '01_EXTENSION' AS seccion, jsonb_build_object('vector_schema', n.nspname,'version',e.extversion) AS resultado
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'
UNION ALL
SELECT '02_RLS',jsonb_agg(jsonb_build_object('tabla',c.relname,'rls',c.relrowsecurity))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('base_conocimiento_indices','base_conocimiento_fragmentos')
UNION ALL
SELECT '03_PERMISOS',jsonb_build_object(
 'anon_indice_select',has_table_privilege('anon','public.base_conocimiento_indices','SELECT'),
 'authenticated_fragmentos_select',has_table_privilege('authenticated','public.base_conocimiento_fragmentos','SELECT'),
 'service_role_fragmentos_insert',has_table_privilege('service_role','public.base_conocimiento_fragmentos','INSERT'),
 'anon_buscar_rpc',has_function_privilege('anon','public.rag_buscar_fragmentos(public.vector,text,integer,real)','EXECUTE'),
 'service_role_buscar_rpc',has_function_privilege('service_role','public.rag_buscar_fragmentos(public.vector,text,integer,real)','EXECUTE'))
UNION ALL
SELECT '04_COBERTURA',jsonb_build_object(
 'documentos_total',(SELECT count(*) FROM public.base_conocimiento),
 'documentos_indexados',(SELECT count(*) FROM public.base_conocimiento_indices),
 'fragmentos_totales',(SELECT count(*) FROM public.base_conocimiento_fragmentos),
 'fragmentos_activos',(SELECT count(*) FROM public.base_conocimiento_fragmentos f
   JOIN public.base_conocimiento_indices i ON i.id_documento=f.id_documento AND i.id_version=f.id_version),
 'documentos_pendientes',(SELECT count(*) FROM public.base_conocimiento d LEFT JOIN public.base_conocimiento_indices i ON i.id_documento=d.id_documento WHERE i.id_documento IS NULL))
UNION ALL
SELECT '05_INTEGRIDAD',jsonb_build_object(
 'indices_desactualizados',(SELECT count(*) FROM public.base_conocimiento_indices i
   JOIN public.base_conocimiento d ON d.id_documento=i.id_documento WHERE i.hash_contenido<>md5(d.contenido_texto)),
 'versiones_sin_publicar',(SELECT count(*) FROM public.base_conocimiento_fragmentos f
   LEFT JOIN public.base_conocimiento_indices i ON i.id_documento=f.id_documento AND i.id_version=f.id_version WHERE i.id_documento IS NULL));
