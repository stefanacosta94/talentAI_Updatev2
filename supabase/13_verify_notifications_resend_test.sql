-- Solo lectura. Exportar resultado CSV con secciones verificables.
SELECT '01_COLUMNAS' AS seccion,
  jsonb_agg(jsonb_build_object('columna',column_name,'tipo',data_type,'default',column_default)) AS resultado
FROM information_schema.columns
WHERE table_schema='public' AND table_name='notificaciones_email'
  AND column_name IN ('prueba_resend_autorizada','prueba_resend_autorizada_por','prueba_resend_autorizada_en')
UNION ALL
SELECT '02_FUNCIONES',jsonb_agg(jsonb_build_object('funcion',p.proname,'security_definer',p.prosecdef))
FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
WHERE ns.nspname='public' AND p.proname IN (
  'talentai_autorizar_prueba_resend','talentai_reclamar_notificaciones_resend_prueba',
  'talentai_finalizar_notificacion_resend_prueba','talentai_reprogramar_notificacion'
)
UNION ALL
SELECT '03_PRIVILEGIOS',jsonb_agg(jsonb_build_object('funcion',p.proname,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')))
FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
WHERE ns.nspname='public' AND p.proname IN (
  'talentai_autorizar_prueba_resend','talentai_reclamar_notificaciones_resend_prueba',
  'talentai_finalizar_notificacion_resend_prueba','talentai_reprogramar_notificacion'
)
UNION ALL
SELECT '04_COLA',jsonb_build_object(
 'total',count(*),'autorizadas_prueba',count(*) FILTER(WHERE prueba_resend_autorizada),
 'aceptadas',count(*) FILTER(WHERE estado='aceptado_proveedor'),
 'requieren_revision',count(*) FILTER(WHERE estado='requiere_revision'))
FROM public.notificaciones_email
UNION ALL
SELECT '05_INTENTOS',jsonb_build_object('total_resend',count(*),
 'aceptados',count(*) FILTER(WHERE resultado='resend_aceptado'),
 'inciertos',count(*) FILTER(WHERE resultado='resend_incierto'))
FROM public.notificaciones_email_intentos
WHERE resultado LIKE 'resend_%'
UNION ALL
SELECT '06_RLS',jsonb_agg(jsonb_build_object('tabla',tablename,'rls',rowsecurity))
FROM pg_tables WHERE schemaname='public' AND tablename IN ('notificaciones_email','notificaciones_email_intentos');
