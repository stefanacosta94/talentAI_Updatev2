-- ================================================================
-- Fase 5B · Verificación única (solo lectura, salida JSON para CSV)
-- Resultado esperado: 06 secciones.
-- ================================================================
WITH triggers AS (
 SELECT jsonb_agg(
   jsonb_build_object(
     'trigger', t.tgname,
     'definicion', pg_get_triggerdef(t.oid, true),
     'habilitado', t.tgenabled
   ) ORDER BY t.tgname
 ) AS data
 FROM pg_trigger t
 WHERE t.tgrelid = 'public.aplicaciones_ats'::regclass
   AND NOT t.tgisinternal
   AND t.tgname IN ('trg_talentai_notificacion_postulacion', 'trg_talentai_notificacion_estado')
),
function_security AS (
 SELECT jsonb_build_object(
   'existe', EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.talentai_registrar_notificacion_ats()')),
   'security_definer', COALESCE((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.talentai_registrar_notificacion_ats()')), false),
   'anon_execute', COALESCE(has_function_privilege('anon','public.talentai_registrar_notificacion_ats()','EXECUTE'), false),
   'authenticated_execute', COALESCE(has_function_privilege('authenticated','public.talentai_registrar_notificacion_ats()','EXECUTE'), false)
 ) AS data
),
queue_access AS (
 SELECT jsonb_build_object(
   'rls_enabled', c.relrowsecurity,
   'anon_select', has_table_privilege('anon','public.notificaciones_email','SELECT'),
   'authenticated_select', has_table_privilege('authenticated','public.notificaciones_email','SELECT'),
   'service_role_insert', has_table_privilege('service_role','public.notificaciones_email','INSERT')
 ) AS data
 FROM pg_class c WHERE c.oid = 'public.notificaciones_email'::regclass
),
queue_stats AS (
 SELECT jsonb_build_object(
   'total', count(*),
   'pendientes', count(*) FILTER (WHERE estado='pendiente'),
   'proveedor_aceptado', count(*) FILTER (WHERE estado='aceptado_proveedor'),
   'eventos', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', tipo_evento, 'cantidad', total) ORDER BY tipo_evento)
     FROM (SELECT tipo_evento, count(*) AS total FROM public.notificaciones_email GROUP BY tipo_evento) q), '[]'::jsonb)
 ) AS data FROM public.notificaciones_email
),
possible_duplicates AS (
 SELECT jsonb_build_object(
   'claves_repetidas', count(*),
   'recepciones_repetidas', (
     SELECT count(*) FROM (
       SELECT id_aplicacion FROM public.notificaciones_email
       WHERE tipo_evento='postulacion_recibida'
       GROUP BY id_aplicacion HAVING count(*) > 1
     ) t
   )
 ) AS data FROM (
   SELECT clave_idempotencia FROM public.notificaciones_email
   GROUP BY clave_idempotencia HAVING count(*) > 1
 ) d
),
transport_info AS (
 SELECT jsonb_build_object(
   'entrega_automatica_configurada_en_sql', false,
   'registros_solo_desde_la_instalacion', true,
   'estados_terminales_requieren_aprobacion', true
 ) AS data
)
SELECT '01_TRIGGERS' AS seccion, data AS datos FROM triggers
UNION ALL SELECT '02_FUNCTION_SECURITY', data FROM function_security
UNION ALL SELECT '03_QUEUE_SECURITY', data FROM queue_access
UNION ALL SELECT '04_QUEUE_STATS', data FROM queue_stats
UNION ALL SELECT '05_DUPLICATES', data FROM possible_duplicates
UNION ALL SELECT '06_DESIGN', data FROM transport_info
ORDER BY seccion;
