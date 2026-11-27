-- TalentAI v2.0 · Verificación no destructiva del Cierre 03
-- 1. Ambas funciones devuelven respuestas consistentes.
SELECT public.ats_estadisticas_panel() AS resumen_panel;
SELECT public.ats_listar_aplicaciones_paginadas(1, 5, NULL, NULL, NULL) AS primera_pagina;

-- 2. Conteos reales = métricas de la RPC.
SELECT
  (SELECT COUNT(*) FROM public.aplicaciones_ats) AS total_real,
  ((public.ats_estadisticas_panel()->>'total_aplicaciones')::bigint) AS total_rpc,
  (SELECT COUNT(DISTINCT id_candidato) FROM public.aplicaciones_ats) AS candidatos_unicos_reales,
  ((public.ats_estadisticas_panel()->>'total_candidatos_unicos')::bigint) AS candidatos_unicos_rpc,
  ((public.ats_listar_aplicaciones_paginadas(1, 5, NULL, NULL, NULL)->>'total')::bigint) AS total_paginado;

-- 3. La paginación no repite IDs entre primera y segunda página (si hay suficientes filas).
WITH p1 AS (
  SELECT (jsonb_array_elements(public.ats_listar_aplicaciones_paginadas(1, 5, NULL, NULL, NULL)->'aplicaciones')->>'id_aplicacion')::integer AS id
), p2 AS (
  SELECT (jsonb_array_elements(public.ats_listar_aplicaciones_paginadas(2, 5, NULL, NULL, NULL)->'aplicaciones')->>'id_aplicacion')::integer AS id
)
SELECT COUNT(*) AS ids_repetidos_entre_paginas FROM p1 JOIN p2 USING (id);

-- 4. Permisos: funciones no ejecutables por roles del cliente.
SELECT p.proname AS funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_puede_ejecutar,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede_ejecutar,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_puede_ejecutar
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname IN ('ats_estadisticas_panel', 'ats_listar_aplicaciones_paginadas');
