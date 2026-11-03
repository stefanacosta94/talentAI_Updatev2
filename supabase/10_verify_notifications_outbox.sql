-- Fase 5A: una sola consulta, resultado exportable como CSV.
SELECT '01_TABLE' AS seccion,
       jsonb_build_object('existe', to_regclass('public.notificaciones_email') IS NOT NULL,
                          'total', (SELECT count(*) FROM public.notificaciones_email)) AS datos
UNION ALL
SELECT '02_RLS', jsonb_build_object('habilitado', c.relrowsecurity)
  FROM pg_class c WHERE c.oid = 'public.notificaciones_email'::regclass
UNION ALL
SELECT '03_CONSTRAINTS', COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'nombre', conname, 'definicion', pg_get_constraintdef(oid)) ORDER BY conname)
  FROM pg_constraint WHERE conrelid = 'public.notificaciones_email'::regclass), '[]'::jsonb)
UNION ALL
SELECT '04_INDEXES', COALESCE((SELECT jsonb_agg(indexname ORDER BY indexname)
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notificaciones_email'), '[]'::jsonb)
UNION ALL
SELECT '05_ACCESS', jsonb_build_object(
  'anon_select', has_table_privilege('anon', 'public.notificaciones_email', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.notificaciones_email', 'SELECT'),
  'service_role_select', has_table_privilege('service_role', 'public.notificaciones_email', 'SELECT'),
  'service_role_insert', has_table_privilege('service_role', 'public.notificaciones_email', 'INSERT'))
ORDER BY seccion;
