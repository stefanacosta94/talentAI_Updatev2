/*
FASE 4B.2 — Migración: roles laborales -> cargos
PRECONDICIÓN: Fase 4B.1 aplicada (empleados.id_usuario ya existe).
Mantiene usuarios.rol (admin/empleado) sin cambios.
Ejecutar una sola vez, preferiblemente con backend detenido, con respaldo de Supabase.
Nunca ejecutar junto con archivo de rollback.
*/
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $$
DECLARE nonzero_permission_count bigint;
BEGIN
  IF to_regclass('public.roles') IS NULL OR to_regclass('public.cargos') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondición fallida: debe existir public.roles y NO existir public.cargos. ¿Ya se ejecutó esta migración?';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='empleados'
      AND column_name='id_usuario' AND udt_name='uuid'
  ) THEN
    RAISE EXCEPTION 'Primero complete y verifique la Fase 4B.1: empleados.id_usuario UUID.';
  END IF;
  SELECT count(*) INTO nonzero_permission_count
  FROM public.roles WHERE nivel_permiso IS DISTINCT FROM 0;
  IF nonzero_permission_count > 0 THEN
    RAISE EXCEPTION 'Existen % roles con nivel_permiso distinto de 0. Revisar antes de retirar ese campo heredado.', nonzero_permission_count;
  END IF;
END $$;

-- PostgreSQL conserva los OID, las relaciones FK, las políticas RLS y los GRANT/REVOKE.
ALTER TABLE public.roles RENAME TO cargos;
ALTER TABLE public.cargos RENAME COLUMN id_rol TO id_cargo;
ALTER TABLE public.cargos RENAME COLUMN nombre_rol TO nombre;
ALTER TABLE public.empleados RENAME COLUMN id_rol TO id_cargo;

-- El campo heredado no define permisos: solo usuarios.rol participa en RBAC.
-- La validación previa evita perder valores no-cero si alguien pobló el catálogo.
ALTER TABLE public.cargos DROP COLUMN nivel_permiso;

-- Homologación de nombres de restricciones e índices existentes.
ALTER TABLE public.cargos RENAME CONSTRAINT roles_pkey TO cargos_pkey;
ALTER TABLE public.empleados RENAME CONSTRAINT empleados_id_rol_fkey TO empleados_id_cargo_fkey;
ALTER INDEX IF EXISTS public.idx_empleados_id_rol RENAME TO idx_empleados_id_cargo;
ALTER INDEX IF EXISTS public.ux_roles_nombre_rol_lower RENAME TO ux_cargos_nombre_lower;

-- Para instalaciones sin el índice previo (04), garantizar unicidad case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cargos_nombre_lower ON public.cargos (lower(nombre));

ALTER TABLE public.cargos
  ADD CONSTRAINT cargos_nombre_valido_check
  CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 120);

COMMENT ON TABLE public.cargos IS 'Catálogo de cargos laborales. No concede privilegios de TalentAI.';
COMMENT ON COLUMN public.cargos.id_cargo IS 'Identificador del cargo laboral.';
COMMENT ON COLUMN public.cargos.nombre IS 'Nombre del cargo laboral (independiente de usuarios.rol).';
COMMENT ON COLUMN public.empleados.id_cargo IS 'Cargo laboral del empleado, referencia a cargos.id_cargo.';
COMMENT ON COLUMN public.usuarios.rol IS 'RBAC de la plataforma: admin o empleado; independiente del cargo laboral.';

COMMIT;
NOTIFY pgrst, 'reload schema';
