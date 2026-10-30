/* TalentAI - Fase 4B.1, verificación posterior. SOLO LECTURA. */

-- Consulta A: columna nueva, tipo, nulabilidad.
SELECT
  table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'empleados'
  AND column_name = 'id_usuario';

-- Esperado: una fila, uuid, YES, NULL como default.

-- Consulta B: restricciones 0..1 y FK, con política de borrado.
SELECT
  conname AS nombre,
  CASE contype WHEN 'u' THEN 'UNIQUE'
               WHEN 'f' THEN 'FOREIGN KEY'
               ELSE contype::text END AS tipo,
  pg_get_constraintdef(oid, true) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.empleados'::regclass
  AND conname IN (
    'empleados_id_usuario_unique',
    'empleados_id_usuario_fkey'
  )
ORDER BY conname;

-- Esperado: 2 filas. FK REFERENCES usuarios(id) ON DELETE SET NULL.

-- Consulta C: conteos sin exponer credenciales ni datos personales.
SELECT
  (SELECT count(*) FROM public.usuarios) AS usuarios,
  (SELECT count(*) FROM public.empleados) AS empleados,
  (SELECT count(*) FROM public.empleados WHERE id_usuario IS NOT NULL) AS empleados_vinculados,
  (SELECT count(*) FROM public.empleados WHERE id_usuario IS NULL) AS empleados_sin_cuenta;

-- Consulta D: comprobar que RLS sigue activado.
SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls_activo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('usuarios', 'empleados', 'departamentos', 'roles')
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- Esperado: 4 filas con rls_activo = true.
