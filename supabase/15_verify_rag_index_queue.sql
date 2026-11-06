-- Fase 7B — Verificación sin mutaciones.
SELECT '01_COLA' seccion,jsonb_build_object(
 'total',(SELECT count(*) FROM public.rag_tareas_indexacion),
 'completadas',(SELECT count(*) FROM public.rag_tareas_indexacion WHERE estado='completado'),
 'pendientes',(SELECT count(*) FROM public.rag_tareas_indexacion WHERE estado IN ('pendiente','parcial')),
 'en_curso',(SELECT count(*) FROM public.rag_tareas_indexacion WHERE estado='procesando'),
 'errores',(SELECT count(*) FROM public.rag_tareas_indexacion WHERE estado IN ('error','pausado')))
 AS resultado
UNION ALL
SELECT '02_RLS',jsonb_build_object(
 'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.rag_tareas_indexacion'::regclass),
 'anon_select',has_table_privilege('anon','public.rag_tareas_indexacion','SELECT'),
 'authenticated_select',has_table_privilege('authenticated','public.rag_tareas_indexacion','SELECT'),
 'service_role_update',has_table_privilege('service_role','public.rag_tareas_indexacion','UPDATE'))
UNION ALL
SELECT '03_FUNCIONES',jsonb_build_object(
 'tomar',to_regprocedure('public.rag_tomar_tarea()') IS NOT NULL,
 'finalizar',to_regprocedure('public.rag_finalizar_lote(integer,uuid,text,integer,integer,text,integer)') IS NOT NULL,
 'reintentar',to_regprocedure('public.rag_reintentar_tarea(integer)') IS NOT NULL,
 'anon_tomar',has_function_privilege('anon','public.rag_tomar_tarea()','EXECUTE'),
 'service_role_tomar',has_function_privilege('service_role','public.rag_tomar_tarea()','EXECUTE'))
UNION ALL
SELECT '04_TRIGGERS',jsonb_build_object(
 'insert',(SELECT t.tgenabled FROM pg_trigger t WHERE t.tgname='tr_rag_encolar_insert' AND NOT t.tgisinternal),
 'update',(SELECT t.tgenabled FROM pg_trigger t WHERE t.tgname='tr_rag_encolar_update' AND NOT t.tgisinternal))
UNION ALL
SELECT '05_INTEGRIDAD',jsonb_build_object(
 'documentos_sin_tarea',(SELECT count(*) FROM public.base_conocimiento d
    LEFT JOIN public.rag_tareas_indexacion t ON t.id_documento=d.id_documento WHERE t.id_documento IS NULL),
 'completados_sin_indice',(SELECT count(*) FROM public.rag_tareas_indexacion t
    LEFT JOIN public.base_conocimiento_indices i ON i.id_documento=t.id_documento
    WHERE t.estado='completado' AND i.id_documento IS NULL),
 'fragmentos_activos',(SELECT count(*) FROM public.base_conocimiento_fragmentos f
   JOIN public.base_conocimiento_indices i ON i.id_documento=f.id_documento AND i.id_version=f.id_version));
