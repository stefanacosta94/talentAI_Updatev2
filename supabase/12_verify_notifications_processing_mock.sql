-- Fase 5C: ejecutar después del SQL 12 y exportar el CSV (6 secciones).
-- EXCLUSIVAMENTE DE LECTURA.
WITH funciones AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'nombre', p.proname,
    'security_definer', p.prosecdef,
    'anon_execute', has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE')
  ) ORDER BY p.proname),'[]'::jsonb) data
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'talentai_reclamar_notificaciones_mock',
    'talentai_finalizar_notificacion_mock',
    'talentai_aprobar_notificacion',
    'talentai_cancelar_notificacion',
    'talentai_reprogramar_notificacion',
    'talentai_conciliar_recepciones'
  )
), tablas AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'tabla',c.relname,'rls',c.relrowsecurity,
    'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
    'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'service_role_select',has_table_privilege('service_role',c.oid,'SELECT')
  ) ORDER BY c.relname),'[]'::jsonb) data
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (
    'notificaciones_email','notificaciones_email_intentos','notificaciones_configuracion'
  ) AND c.relkind IN ('r','p')
), cola AS (
  SELECT jsonb_build_object(
    'total',count(*),
    'pendiente',count(*) FILTER (WHERE estado='pendiente'),
    'procesando',count(*) FILTER (WHERE estado='procesando'),
    'fallido',count(*) FILTER (WHERE estado='fallido'),
    'requiere_revision',count(*) FILTER (WHERE estado='requiere_revision'),
    'aceptado_proveedor',count(*) FILTER (WHERE estado='aceptado_proveedor'),
    'cancelado',count(*) FILTER (WHERE estado='cancelado'),
    'sin_aprobacion',count(*) FILTER (WHERE datos->>'requiere_aprobacion'='true' AND datos->>'aprobado_envio' <> 'true'),
    'leasings_vencidos',count(*) FILTER (WHERE estado='procesando' AND bloqueado_hasta < now())
  ) data FROM public.notificaciones_email
), intentos AS (
  SELECT jsonb_build_object('total',count(*),'simulados',count(*) FILTER (WHERE resultado='simulado'),
    'fallos',count(*) FILTER (WHERE resultado IN ('fallo_transitorio','fallo_permanente')),
    'leases_expirados',count(*) FILTER (WHERE resultado='lease_expirado')) data
  FROM public.notificaciones_email_intentos
), corte AS (
  SELECT jsonb_build_object('id_aplicacion_desde', id_aplicacion_desde, 'creado_en', creado_en) data
  FROM public.notificaciones_configuracion WHERE id=1
), duplicados AS (
  SELECT jsonb_build_object('claves_duplicadas',count(*)) data FROM (
    SELECT clave_idempotencia FROM public.notificaciones_email GROUP BY clave_idempotencia HAVING count(*)>1
  ) x
)
SELECT '01_FUNCIONES' seccion, data datos FROM funciones
UNION ALL SELECT '02_RLS_Y_PERMISOS',data FROM tablas
UNION ALL SELECT '03_COLA',data FROM cola
UNION ALL SELECT '04_INTENTOS',data FROM intentos
UNION ALL SELECT '05_CORTE_CONCILIACION',data FROM corte
UNION ALL SELECT '06_DUPLICADOS',data FROM duplicados
ORDER BY seccion;
