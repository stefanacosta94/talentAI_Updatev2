/* Fase 4B.2 - verificación posterior. SOLO LECTURA. UNA FILA para exportar CSV. */
SELECT
  (to_regclass('public.cargos') IS NOT NULL) AS cargos_existe,
  (to_regclass('public.roles') IS NULL) AS roles_heredados_renombrados,
  (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='empleados'
        AND column_name='id_cargo' AND data_type='integer'
    )
  ) AS empleado_id_cargo_ok,
  (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='empleados'
        AND column_name='id_usuario' AND data_type='uuid' AND is_nullable='YES'
    )
  ) AS empleado_id_usuario_ok,
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nombre', conname, 'definicion', pg_get_constraintdef(oid)
    ) ORDER BY conname), '[]'::jsonb)
    FROM pg_constraint
    WHERE conrelid='public.empleados'::regclass
      AND conname IN ('empleados_id_usuario_unique','empleados_id_usuario_fkey','empleados_id_cargo_fkey')
  ) AS restricciones_empleado,
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('tabla',c.relname,'rls',c.relrowsecurity)
      ORDER BY c.relname),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('usuarios','empleados','cargos','departamentos')
  ) AS estado_rls,
  (SELECT count(*) FROM public.cargos) AS total_cargos,
  (SELECT count(*) FROM public.empleados) AS total_empleados,
  (SELECT count(*) FROM public.empleados WHERE id_usuario IS NOT NULL) AS empleados_vinculados,
  (SELECT count(*) FROM public.empleados e LEFT JOIN public.cargos c ON c.id_cargo=e.id_cargo
    WHERE e.id_cargo IS NOT NULL AND c.id_cargo IS NULL) AS cargos_huerfanos,
  (SELECT count(*) FROM public.empleados e LEFT JOIN public.usuarios u ON u.id=e.id_usuario
    WHERE e.id_usuario IS NOT NULL AND u.id IS NULL) AS usuarios_huerfanos;
