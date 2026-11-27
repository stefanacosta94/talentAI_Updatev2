-- Solo en caso de reversión intencional. Antes de ejecutar, respaldar.
BEGIN;
DROP TRIGGER IF EXISTS trg_talentai_cargo_departamento_empleados ON public.cargos;
DROP TRIGGER IF EXISTS trg_talentai_empleado_cargo_departamento ON public.empleados;
DROP FUNCTION IF EXISTS public.talentai_validar_cargo_departamento_empleados();
DROP FUNCTION IF EXISTS public.talentai_validar_empleado_cargo_departamento();
ALTER TABLE public.cargos DROP CONSTRAINT IF EXISTS cargos_id_departamento_fkey;
DROP INDEX IF EXISTS public.idx_cargos_id_departamento;
ALTER TABLE public.cargos DROP COLUMN IF EXISTS id_departamento;
COMMIT;
NOTIFY pgrst, 'reload schema';
