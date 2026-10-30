/*
  TalentAI — Fase 4B.1
  Relación opcional entre empleado y usuario del sistema.

  Basado en el preflight 07:
    usuarios.id : uuid (PK)
    empleados.id_empleado : integer (PK)
    empleados : 0 filas al auditar

  CAMBIOS:
    1) Agrega empleados.id_usuario UUID NULL.
    2) Añade unicidad 0..1 por usuario (se permiten múltiples NULL).
    3) Añade FK con ON DELETE SET NULL.
    4) Documenta semántica de roles de seguridad y puestos laborales.

  NO CAMBIA:
    - usuarios.rol ni el mecanismo JWT/RBAC
    - empleados.id_rol ni tabla roles
    - departamentos, vacantes, tablas ATS
    - registros existentes
    - RLS, Storage, GRANT/REVOKE

  Antes de ejecutar: crear checkpoint en Git y disponer de respaldo DB.
  Ejecutar en Supabase SQL Editor como una sola consulta.
*/

BEGIN;

-- No dejar esperando indefinidamente a otras transacciones.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Guardarraíl: confirmar el tipo de PK de usuarios y que el origen existe.
DO $$
DECLARE
  usuario_pk_type text;
  empleado_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO usuario_pk_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.usuarios'::regclass
    AND a.attname = 'id' AND NOT a.attisdropped;

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO empleado_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.empleados'::regclass
    AND a.attname = 'id_usuario' AND NOT a.attisdropped;

  IF usuario_pk_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'Se esperaba usuarios.id UUID, pero se encontró: %', usuario_pk_type;
  END IF;

  IF empleado_id_type IS NOT NULL AND empleado_id_type <> 'uuid' THEN
    RAISE EXCEPTION 'La columna empleados.id_usuario ya existe con tipo inesperado: %', empleado_id_type;
  END IF;
END $$;

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS id_usuario uuid;

-- UNIQUE permite varios NULL: empleados sin cuenta son válidos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.empleados'::regclass
      AND conname = 'empleados_id_usuario_unique'
  ) THEN
    ALTER TABLE public.empleados
      ADD CONSTRAINT empleados_id_usuario_unique UNIQUE (id_usuario);
  END IF;
END $$;

-- Una cuenta eliminada no debe borrar el expediente laboral.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.empleados'::regclass
      AND conname = 'empleados_id_usuario_fkey'
  ) THEN
    ALTER TABLE public.empleados
      ADD CONSTRAINT empleados_id_usuario_fkey
      FOREIGN KEY (id_usuario)
      REFERENCES public.usuarios(id)
      ON UPDATE NO ACTION
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.usuarios.rol IS
  'Rol de autorización de TalentAI (admin/empleado). Fuente de verdad para RBAC; no es el puesto laboral.';

COMMENT ON COLUMN public.empleados.id_usuario IS
  'Vínculo opcional y único con usuarios.id. Un empleado puede existir sin cuenta de acceso.';

COMMENT ON COLUMN public.empleados.id_rol IS
  'Referencia al catálogo actual roles. Representa puesto/cargo laboral; pendiente de homologación de nombre en Fase 4B.2.';

COMMENT ON TABLE public.roles IS
  'Catálogo heredado de puestos/cargos laborales. No debe utilizarse como fuente de autorización del sistema.';

COMMENT ON COLUMN public.roles.nivel_permiso IS
  'Campo heredado de diseño: no otorga privilegios en Express/JWT. Pendiente de revisión y retiro controlado.';

COMMIT;

-- Refrescar la caché del esquema de PostgREST tras el DDL.
NOTIFY pgrst, 'reload schema';
