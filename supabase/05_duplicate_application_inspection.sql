/*
=========================================================
FASE 3C - INSPECCIÓN DE APLICACIONES DUPLICADAS
SOLO LECTURA
=========================================================
*/

SELECT
  a.id_aplicacion,
  a.id_candidato,
  c.nombre AS candidato,
  c.correo,
  a.id_vacante,
  v.titulo AS vacante,
  a.estado_proceso,
  a.ai_match_score,
  a.url_archivo_cv
FROM public.aplicaciones_ats a
JOIN public.candidatos c
  ON c.id_candidato = a.id_candidato
JOIN public.vacantes v
  ON v.id_vacante = a.id_vacante
WHERE (a.id_candidato, a.id_vacante) IN (
  SELECT id_candidato, id_vacante
  FROM public.aplicaciones_ats
  GROUP BY id_candidato, id_vacante
  HAVING COUNT(*) > 1
)
ORDER BY a.id_candidato, a.id_vacante, a.id_aplicacion;
