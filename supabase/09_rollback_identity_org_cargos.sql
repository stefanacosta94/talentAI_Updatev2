/*
ROLLBACK MANUAL DE FASE 4B.2 - SOLO SI HAY QUE REVERTIR Y SE RESTAURARÁ EL CÓDIGO ANTERIOR.
Si creaste cargos nuevos, el campo heredado nivel_permiso se restablece en 0 (no concede acceso).
NO revierte la relación usuarios/empleados creada en Fase 4B.1.
Ejecutar en sesión separada después de respaldar la BD; NO ejecutar junto con 09_identity_org_cargos.sql.
*/
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.cargos') IS NULL OR to_regclass('public.roles') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback no aplicable: se esperaba cargos existente y roles ausente.';
  END IF;
END $$;
ALTER TABLE public.cargos DROP CONSTRAINT IF EXISTS cargos_nombre_valido_check;
ALTER INDEX IF EXISTS public.ux_cargos_nombre_lower RENAME TO ux_roles_nombre_rol_lower;
ALTER INDEX IF EXISTS public.idx_empleados_id_cargo RENAME TO idx_empleados_id_rol;
ALTER TABLE public.empleados RENAME CONSTRAINT empleados_id_cargo_fkey TO empleados_id_rol_fkey;
ALTER TABLE public.cargos RENAME CONSTRAINT cargos_pkey TO roles_pkey;
ALTER TABLE public.empleados RENAME COLUMN id_cargo TO id_rol;
ALTER TABLE public.cargos RENAME COLUMN nombre TO nombre_rol;
ALTER TABLE public.cargos RENAME COLUMN id_cargo TO id_rol;
ALTER TABLE public.cargos ADD COLUMN nivel_permiso integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargos RENAME TO roles;
COMMENT ON TABLE public.roles IS 'Catálogo heredado de cargos laborales; no otorga privilegios de TalentAI.';
COMMIT;
NOTIFY pgrst, 'reload schema';
