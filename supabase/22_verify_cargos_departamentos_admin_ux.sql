-- Solo lectura. Esperado: columna/FK/triggers = true; incoherencias = 0.
SELECT
 EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='cargos' AND column_name='id_departamento') AS columna_ok,
 EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cargos_id_departamento_fkey' AND conrelid='public.cargos'::regclass) AS fk_ok,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados'::regclass AND tgname='trg_talentai_empleado_cargo_departamento' AND NOT tgisinternal) AS trigger_empleados_ok,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.cargos'::regclass AND tgname='trg_talentai_cargo_departamento_empleados' AND NOT tgisinternal) AS trigger_cargos_ok,
 (SELECT count(*) FROM public.cargos) AS total_cargos,
 (SELECT count(*) FROM public.cargos WHERE id_departamento IS NULL) AS cargos_por_asignar,
 (SELECT count(*) FROM public.empleados e JOIN public.cargos c ON e.id_cargo=c.id_cargo
  WHERE e.id_departamento IS NOT NULL AND c.id_departamento IS NOT NULL
   AND e.id_departamento<>c.id_departamento) AS incoherencias_historicas;
