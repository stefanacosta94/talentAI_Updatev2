-- TalentAI v2.0 | Cierre 05 | Vinculación organizacional del cargo (NO es RBAC)
-- Ejecutar una sola vez, DESPUÉS del Cierre 03. Hacer respaldo previo.
-- No cambia ni renumera claves primarias. Compatible con cargos existentes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.cargos ADD COLUMN IF NOT EXISTS id_departamento integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargos_id_departamento_fkey' AND conrelid = 'public.cargos'::regclass) THEN
    ALTER TABLE public.cargos ADD CONSTRAINT cargos_id_departamento_fkey
      FOREIGN KEY (id_departamento) REFERENCES public.departamentos(id_departamento)
      ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cargos_id_departamento ON public.cargos(id_departamento);

-- Datos históricos: inferir la relación SOLO si todos los empleados con
-- departamento conocido que usan el cargo pertenecen a la misma área.
-- Los cargos sin empleados o con uso en múltiples áreas permanecen sin departamento.
UPDATE public.cargos AS c SET id_departamento = x.id_departamento
FROM (
 SELECT id_cargo, min(id_departamento) AS id_departamento
 FROM public.empleados
 WHERE id_cargo IS NOT NULL AND id_departamento IS NOT NULL
 GROUP BY id_cargo HAVING count(DISTINCT id_departamento) = 1
) AS x
WHERE c.id_cargo=x.id_cargo AND c.id_departamento IS NULL;

-- La coherencia se exige en escrituras posteriores, sin bloquear la migración
-- de registros históricos: si hay cargo y departamento conocidos deben coincidir.
CREATE OR REPLACE FUNCTION public.talentai_validar_empleado_cargo_departamento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE cargo_departamento integer;
BEGIN
  IF NEW.id_cargo IS NOT NULL AND NEW.id_departamento IS NOT NULL THEN
    SELECT id_departamento INTO cargo_departamento FROM public.cargos WHERE id_cargo=NEW.id_cargo;
    IF cargo_departamento IS NOT NULL AND cargo_departamento <> NEW.id_departamento THEN
      RAISE EXCEPTION 'CARGO_DEPARTAMENTO: el cargo pertenece a otro departamento' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_talentai_empleado_cargo_departamento ON public.empleados;
CREATE TRIGGER trg_talentai_empleado_cargo_departamento
  BEFORE INSERT OR UPDATE OF id_cargo, id_departamento ON public.empleados
  FOR EACH ROW EXECUTE FUNCTION public.talentai_validar_empleado_cargo_departamento();

CREATE OR REPLACE FUNCTION public.talentai_validar_cargo_departamento_empleados()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id_departamento IS NOT NULL AND NEW.id_departamento IS DISTINCT FROM OLD.id_departamento
    AND EXISTS (SELECT 1 FROM public.empleados e WHERE e.id_cargo=NEW.id_cargo
      AND e.id_departamento IS NOT NULL AND e.id_departamento <> NEW.id_departamento)
  THEN
    RAISE EXCEPTION 'CARGO_DEPARTAMENTO: existen empleados de otra área usando el cargo' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_talentai_cargo_departamento_empleados ON public.cargos;
CREATE TRIGGER trg_talentai_cargo_departamento_empleados
  BEFORE UPDATE OF id_departamento ON public.cargos
  FOR EACH ROW EXECUTE FUNCTION public.talentai_validar_cargo_departamento_empleados();

COMMENT ON COLUMN public.cargos.id_departamento IS 'Departamento de referencia opcional del cargo laboral. No concede permisos.';
COMMIT;
NOTIFY pgrst, 'reload schema';
