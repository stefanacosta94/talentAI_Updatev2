/*
=========================================================
VERIFICACIÓN POSTERIOR - FASE 3B
SOLO LECTURA
=========================================================
*/

-- 1. Constraints relevantes
SELECT
  conrelid::regclass::text AS tabla,
  conname AS constraint_name,
  pg_get_constraintdef(oid, true) AS definicion
FROM pg_constraint
WHERE conrelid IN (
  'public.usuarios'::regclass,
  'public.empleados'::regclass,
  'public.vacantes'::regclass,
  'public.aplicaciones_ats'::regclass
)
AND conname IN (
  'usuarios_rol_check',
  'empleados_estado_check',
  'vacantes_estado_check',
  'aplicaciones_ats_match_score_check'
)
ORDER BY tabla, constraint_name;

-- 2. Nullability/defaults cambiados
SELECT
  table_name,
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
  (table_name = 'usuarios' AND column_name = 'rol')
  OR (table_name = 'empleados' AND column_name = 'estado')
  OR (table_name = 'vacantes' AND column_name IN ('estado','id_departamento'))
  OR (table_name = 'aplicaciones_ats' AND column_name IN ('id_candidato','id_vacante','estado_proceso'))
)
ORDER BY table_name, ordinal_position;

-- 3. Índices nuevos
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname LIKE 'idx_%'
    OR indexname LIKE 'ux_%'
  )
ORDER BY tablename, indexname;

-- 4. Verificación final de score
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE ai_match_score < 0) AS below_zero,
  COUNT(*) FILTER (WHERE ai_match_score > 100) AS above_100
FROM public.aplicaciones_ats;
