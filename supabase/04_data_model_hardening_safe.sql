/*
=========================================================
FASE 3B - HARDENING SEGURO DEL MODELO DE DATOS
Proyecto: Plataforma Web con IA para RR.HH.

Este script aplica únicamente cambios compatibles con los
datos observados en el preflight de Fase 3A.

NO:
- elimina filas
- modifica IDs
- elimina columnas
- toca RLS o Storage
- crea la restricción UNIQUE candidato+vacante (hay 1 duplicado)
- modifica vector_embedding
=========================================================
*/

BEGIN;

-- =====================================================
-- 1. DOMINIOS BÁSICOS Y NULLABILITY
-- =====================================================

-- Usuarios: el rol del sistema siempre debe existir.
ALTER TABLE public.usuarios
  ALTER COLUMN rol SET DEFAULT 'empleado',
  ALTER COLUMN rol SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuarios_rol_check'
      AND conrelid = 'public.usuarios'::regclass
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_rol_check
      CHECK (rol IN ('admin', 'empleado'));
  END IF;
END $$;

-- Empleados: el estado funcional se limita a Activo/Inactivo.
ALTER TABLE public.empleados
  ALTER COLUMN estado SET DEFAULT 'Activo',
  ALTER COLUMN estado SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empleados_estado_check'
      AND conrelid = 'public.empleados'::regclass
  ) THEN
    ALTER TABLE public.empleados
      ADD CONSTRAINT empleados_estado_check
      CHECK (estado IN ('Activo', 'Inactivo'));
  END IF;
END $$;

-- Vacantes: unificamos el default con el código actual.
-- Los datos existentes ya usan "Activa".
ALTER TABLE public.vacantes
  ALTER COLUMN estado SET DEFAULT 'Activa',
  ALTER COLUMN estado SET NOT NULL,
  ALTER COLUMN id_departamento SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vacantes_estado_check'
      AND conrelid = 'public.vacantes'::regclass
  ) THEN
    ALTER TABLE public.vacantes
      ADD CONSTRAINT vacantes_estado_check
      CHECK (estado IN ('Activa', 'Inactiva'));
  END IF;
END $$;

-- Una aplicación ATS no tiene sentido sin candidato ni vacante.
ALTER TABLE public.aplicaciones_ats
  ALTER COLUMN id_candidato SET NOT NULL,
  ALTER COLUMN id_vacante SET NOT NULL,
  ALTER COLUMN estado_proceso SET NOT NULL;

-- El Match Score, cuando exista, debe mantenerse entre 0 y 100.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aplicaciones_ats_match_score_check'
      AND conrelid = 'public.aplicaciones_ats'::regclass
  ) THEN
    ALTER TABLE public.aplicaciones_ats
      ADD CONSTRAINT aplicaciones_ats_match_score_check
      CHECK (
        ai_match_score IS NULL
        OR (ai_match_score >= 0 AND ai_match_score <= 100)
      );
  END IF;
END $$;

-- =====================================================
-- 2. UNICIDAD CASE-INSENSITIVE
-- =====================================================
-- El preflight confirmó que no hay duplicados por mayúsculas/minúsculas.

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_lower
  ON public.usuarios (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS ux_empleados_correo_lower
  ON public.empleados (lower(correo));

CREATE UNIQUE INDEX IF NOT EXISTS ux_candidatos_correo_lower
  ON public.candidatos (lower(correo));

CREATE UNIQUE INDEX IF NOT EXISTS ux_departamentos_nombre_lower
  ON public.departamentos (lower(nombre));

CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_nombre_rol_lower
  ON public.roles (lower(nombre_rol));

-- =====================================================
-- 3. ÍNDICES PARA FOREIGN KEYS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_aplicaciones_ats_id_candidato
  ON public.aplicaciones_ats (id_candidato);

CREATE INDEX IF NOT EXISTS idx_aplicaciones_ats_id_vacante
  ON public.aplicaciones_ats (id_vacante);

CREATE INDEX IF NOT EXISTS idx_bitacora_auditoria_id_usuario
  ON public.bitacora_auditoria (id_usuario);

CREATE INDEX IF NOT EXISTS idx_empleados_id_departamento
  ON public.empleados (id_departamento);

CREATE INDEX IF NOT EXISTS idx_empleados_id_rol
  ON public.empleados (id_rol);

CREATE INDEX IF NOT EXISTS idx_logs_interaccion_ia_id_empleado
  ON public.logs_interaccion_ia (id_empleado);

CREATE INDEX IF NOT EXISTS idx_solicitudes_rrhh_id_empleado
  ON public.solicitudes_rrhh (id_empleado);

CREATE INDEX IF NOT EXISTS idx_vacantes_id_departamento
  ON public.vacantes (id_departamento);

-- =====================================================
-- 4. ÍNDICES DE CONSULTA FRECUENTE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_bitacora_auditoria_fecha_desc
  ON public.bitacora_auditoria (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_aplicaciones_ats_estado_proceso
  ON public.aplicaciones_ats (estado_proceso);

CREATE INDEX IF NOT EXISTS idx_vacantes_estado
  ON public.vacantes (estado);

CREATE INDEX IF NOT EXISTS idx_base_conocimiento_fecha_actualizacion_desc
  ON public.base_conocimiento (fecha_actualizacion DESC);

COMMIT;

/*
PENDIENTES INTENCIONALES:
1. NO se crea UNIQUE(id_candidato, id_vacante) porque el preflight
   encontró un duplicado real.
2. NO se restringe todavía aplicaciones_ats.estado_proceso porque
   primero debemos homologar backend/frontend:
   Nueva / Recibida / En Revisión / Entrevista / Contratado / Descartado.
3. NO se hace vector_embedding NOT NULL: los 2 documentos actuales
   todavía no tienen embeddings.
4. NO se hacen id_departamento/id_rol NOT NULL en empleados porque
   el catálogo de roles está vacío y ese módulo debe definirse primero.
*/
