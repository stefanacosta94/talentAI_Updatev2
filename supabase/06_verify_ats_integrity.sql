/* VERIFICACIÓN POSTERIOR - FASE 3C */

-- Debe devolver 0 filas.
SELECT id_candidato, id_vacante, COUNT(*) AS cantidad
FROM public.aplicaciones_ats
GROUP BY id_candidato, id_vacante
HAVING COUNT(*) > 1;

-- Todos los estados deben pertenecer al workflow homologado.
SELECT estado_proceso, COUNT(*) AS cantidad
FROM public.aplicaciones_ats
GROUP BY estado_proceso
ORDER BY estado_proceso;

-- Constraint UNIQUE + CHECK.
SELECT
  conname,
  pg_get_constraintdef(oid, true) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.aplicaciones_ats'::regclass
  AND conname IN (
    'aplicaciones_ats_candidato_vacante_unique',
    'aplicaciones_ats_estado_proceso_check',
    'aplicaciones_ats_match_score_check'
  )
ORDER BY conname;

-- Los CV antiguos deberían haber quedado normalizados a rutas privadas.
SELECT id_aplicacion, url_archivo_cv
FROM public.aplicaciones_ats
ORDER BY id_aplicacion;
