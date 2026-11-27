-- TalentAI v2.0 · Cierre 03: consultas ATS escalables y métricas consistentes.
-- PRERREQUISITOS: esquemas ATS existentes, migraciones 04, 06, 18, 19, 20.
-- Ejecutar con SQL Editor (rol postgres). No modifica registros existentes.
BEGIN;

-- Índices de filtrado/ordenación para el listado administrativo.
CREATE INDEX IF NOT EXISTS idx_ats_match_orden
  ON public.aplicaciones_ats (ai_match_score DESC NULLS LAST, id_aplicacion DESC);
CREATE INDEX IF NOT EXISTS idx_ats_estado_match_orden
  ON public.aplicaciones_ats (estado_proceso, ai_match_score DESC NULLS LAST, id_aplicacion DESC);
CREATE INDEX IF NOT EXISTS idx_ats_vacante_match_orden
  ON public.aplicaciones_ats (id_vacante, ai_match_score DESC NULLS LAST, id_aplicacion DESC);

-- Solo service_role puede ejecutar las funciones; el frontend nunca recibe las credenciales de BD.
CREATE OR REPLACE FUNCTION public.ats_estadisticas_panel()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $sql$
WITH resumen AS (
  SELECT
    COUNT(*)::bigint AS total_aplicaciones,
    COUNT(DISTINCT a.id_candidato)::bigint AS total_candidatos_unicos,
    COUNT(*) FILTER (WHERE a.ai_match_score IS NULL)::bigint AS pendientes_ia,
    COUNT(*) FILTER (WHERE a.ai_match_score IS NOT NULL)::bigint AS evaluadas_ia,
    COALESCE(ROUND(AVG(a.ai_match_score) FILTER (WHERE a.ai_match_score IS NOT NULL))::integer, 0) AS score_promedio_ia
  FROM public.aplicaciones_ats a
), etapas AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('estado', e.estado_proceso, 'cantidad', e.cantidad)
                    ORDER BY e.estado_proceso), '[]'::jsonb) AS por_estado
  FROM (
    SELECT a.estado_proceso, COUNT(*)::bigint AS cantidad
    FROM public.aplicaciones_ats a
    GROUP BY a.estado_proceso
  ) e
)
SELECT jsonb_build_object(
  'total_vacantes', (SELECT COUNT(*) FROM public.vacantes),
  'total_empleados', (SELECT COUNT(*) FROM public.empleados),
  'total_aplicaciones', r.total_aplicaciones,
  'total_candidatos_unicos', r.total_candidatos_unicos,
  'pendientes_ia', r.pendientes_ia,
  'evaluadas_ia', r.evaluadas_ia,
  'score_promedio_ia', r.score_promedio_ia,
  'por_estado', e.por_estado
)
FROM resumen r CROSS JOIN etapas e;
$sql$;
REVOKE ALL ON FUNCTION public.ats_estadisticas_panel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_estadisticas_panel() TO service_role;

CREATE OR REPLACE FUNCTION public.ats_listar_aplicaciones_paginadas(
  p_pagina integer DEFAULT 1,
  p_limite integer DEFAULT 20,
  p_busqueda text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_id_vacante integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_resultado jsonb;
  v_busqueda text := NULLIF(btrim(p_busqueda), '');
BEGIN
  IF p_pagina IS NULL OR p_pagina < 1 OR p_pagina > 100000 OR
     p_limite IS NULL OR p_limite < 1 OR p_limite > 50 OR
     (v_busqueda IS NOT NULL AND length(v_busqueda) > 100) OR
     (p_id_vacante IS NOT NULL AND p_id_vacante < 1) OR
     (p_estado IS NOT NULL AND p_estado NOT IN ('Recibida','En Revisión','Entrevista','Contratado','Descartado')) THEN
    RAISE EXCEPTION 'Filtros ATS inválidos' USING ERRCODE = '22023';
  END IF;

  WITH filtradas AS NOT MATERIALIZED (
    SELECT
      a.id_aplicacion, a.ai_match_score, a.ai_resumen_habilidades, a.estado_proceso,
      (a.url_archivo_cv IS NOT NULL AND btrim(a.url_archivo_cv) <> '') AS tiene_cv,
      c.nombre AS candidato_nombre, c.correo AS candidato_correo, c.telefono AS candidato_telefono,
      v.titulo AS vacante_titulo, d.nombre AS departamento_nombre
    FROM public.aplicaciones_ats a
    LEFT JOIN public.candidatos c ON c.id_candidato = a.id_candidato
    LEFT JOIN public.vacantes v ON v.id_vacante = a.id_vacante
    LEFT JOIN public.departamentos d ON d.id_departamento = v.id_departamento
    WHERE (p_estado IS NULL OR a.estado_proceso = p_estado)
      AND (p_id_vacante IS NULL OR a.id_vacante = p_id_vacante)
      AND (v_busqueda IS NULL OR
           position(lower(v_busqueda) in lower(concat_ws(' ', c.nombre, c.correo, v.titulo))) > 0)
  ), conteo AS (
    SELECT COUNT(*)::bigint AS total FROM filtradas
  ), pagina AS (
    SELECT f.* FROM filtradas f
    ORDER BY f.ai_match_score DESC NULLS LAST, f.id_aplicacion DESC
    LIMIT p_limite OFFSET (p_pagina - 1) * p_limite
  )
  SELECT jsonb_build_object(
    'total', (SELECT total FROM conteo),
    'aplicaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id_aplicacion', p.id_aplicacion,
        'ai_match_score', p.ai_match_score,
        'ai_resumen_habilidades', p.ai_resumen_habilidades,
        'estado_proceso', p.estado_proceso,
        'tiene_cv', p.tiene_cv,
        'candidatos', jsonb_build_object('nombre', p.candidato_nombre, 'correo', p.candidato_correo, 'telefono', p.candidato_telefono),
        'vacantes', jsonb_build_object('titulo', p.vacante_titulo, 'departamentos', jsonb_build_object('nombre', p.departamento_nombre))
      ) ORDER BY p.ai_match_score DESC NULLS LAST, p.id_aplicacion DESC)
      FROM pagina p
    ), '[]'::jsonb)
  ) INTO v_resultado;
  RETURN v_resultado;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_listar_aplicaciones_paginadas(integer, integer, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_listar_aplicaciones_paginadas(integer, integer, text, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.ats_estadisticas_panel() IS
  'Métricas ATS exactas agregadas en PostgreSQL, sin límite de 1000 filas PostgREST';
COMMENT ON FUNCTION public.ats_listar_aplicaciones_paginadas(integer, integer, text, text, integer) IS
  'Listado ATS paginado; filtros aplicados antes del LIMIT y sin exponer rutas de CV';
COMMIT;
