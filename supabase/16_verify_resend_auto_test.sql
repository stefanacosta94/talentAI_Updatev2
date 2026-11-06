-- Verificacion no destructiva. Ejecutar desde Supabase SQL Editor.
-- Salida por secciones; no expone emails, API keys ni payloads.
SELECT '01_COLUMNS' AS seccion,
 jsonb_build_object('campos', count(*), 'permiso_por_defecto_falso',
   count(*) FILTER (WHERE column_name='auto_resend_autorizado' AND column_default='false')=1) AS resultado
FROM information_schema.columns
WHERE table_schema='public' AND table_name='notificaciones_email'
  AND column_name IN ('auto_resend_autorizado','auto_resend_autorizado_por','auto_resend_autorizado_en')
UNION ALL
SELECT '02_FUNCTIONS',jsonb_build_object('funciones',count(*),'security_definer',
 count(*) FILTER (WHERE p.prosecdef)=3)
FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
WHERE ns.nspname='public' AND p.proname IN (
 'talentai_autorizar_auto_resend','talentai_revocar_auto_resend','talentai_reclamar_notificaciones_resend_auto')
UNION ALL
SELECT '03_SECURITY',jsonb_build_object(
 'rls',c.relrowsecurity,
 'anon_select',has_table_privilege('anon','public.notificaciones_resend_auto_reservas','SELECT'),
 'authenticated_select',has_table_privilege('authenticated','public.notificaciones_resend_auto_reservas','SELECT'),
 'service_role_select',has_table_privilege('service_role','public.notificaciones_resend_auto_reservas','SELECT'))
FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
WHERE ns.nspname='public' AND c.relname='notificaciones_resend_auto_reservas'
UNION ALL
SELECT '04_QUEUE',jsonb_build_object('total',count(*),
 'autorizadas_auto',count(*) FILTER(WHERE auto_resend_autorizado),
 'pendientes_auto',count(*) FILTER(WHERE auto_resend_autorizado AND estado='pendiente'),
 'aceptadas',count(*) FILTER(WHERE estado='aceptado_proveedor'))
FROM public.notificaciones_email
UNION ALL
SELECT '05_RESERVATIONS',jsonb_build_object('total',count(*),
 'hoy_utc',count(*) FILTER(WHERE (reservado_en AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date))
FROM public.notificaciones_resend_auto_reservas
UNION ALL
SELECT '06_INTEGRITY',jsonb_build_object(
 'auto_sin_prueba',count(*) FILTER(WHERE auto_resend_autorizado AND NOT prueba_resend_autorizada),
 'auto_sin_fecha',count(*) FILTER(WHERE auto_resend_autorizado AND auto_resend_autorizado_en IS NULL))
FROM public.notificaciones_email;
