-- TalentAI fase de cierre: evaluaciones ATS diferidas, durables y recuperables.
-- Dependencias: Fases 3B/3C, public.aplicaciones_ats, Supabase service_role.
-- Aplicar antes de ATS_ASYNC_EVALUATION_ENABLED=true. Idempotente para reejecución.
BEGIN;

-- Una postulación puede existir antes del análisis inteligente.
ALTER TABLE public.aplicaciones_ats
  ALTER COLUMN ai_match_score DROP NOT NULL,
  ALTER COLUMN ai_resumen_habilidades DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.ats_evaluaciones_ia (
  id_aplicacion integer PRIMARY KEY REFERENCES public.aplicaciones_ats(id_aplicacion) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesando', 'error', 'completada', 'pausada')),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proxima_ejecucion timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_hasta timestamptz,
  ultimo_error_codigo text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ats_eval_pendientes
  ON public.ats_evaluaciones_ia (proxima_ejecucion, id_aplicacion)
  WHERE estado IN ('pendiente', 'error', 'procesando');

ALTER TABLE public.ats_evaluaciones_ia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ats_evaluaciones_ia FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ats_evaluaciones_ia TO service_role;

CREATE OR REPLACE FUNCTION public.ats_encolar_evaluacion_ia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  INSERT INTO public.ats_evaluaciones_ia (id_aplicacion)
    VALUES (NEW.id_aplicacion)
    ON CONFLICT (id_aplicacion) DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_encolar_evaluacion_ia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ats_encolar_evaluacion_ia ON public.aplicaciones_ats;
CREATE TRIGGER trg_ats_encolar_evaluacion_ia
  AFTER INSERT ON public.aplicaciones_ats FOR EACH ROW
  EXECUTE FUNCTION public.ats_encolar_evaluacion_ia();

-- Reconciliación inicial: candidatos históricos pendientes de evaluación.
INSERT INTO public.ats_evaluaciones_ia (id_aplicacion)
SELECT a.id_aplicacion FROM public.aplicaciones_ats a
WHERE a.ai_match_score IS NULL AND a.url_archivo_cv IS NOT NULL
ON CONFLICT (id_aplicacion) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ats_tomar_evaluacion()
RETURNS TABLE (id_aplicacion integer, lease_token uuid, intentos integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  -- Si el proceso murió tres veces, no reservarlo infinitamente.
  UPDATE public.ats_evaluaciones_ia e
    SET estado = 'pausada', lease_token = NULL, lease_hasta = NULL,
        ultimo_error_codigo = 'LEASE_AGOTADO', actualizado_en = now()
    WHERE e.estado = 'procesando' AND e.lease_hasta < now() AND e.intentos >= 3;

  RETURN QUERY
  WITH siguiente AS (
    SELECT e.id_aplicacion
      FROM public.ats_evaluaciones_ia e
      WHERE e.intentos < 3 AND (
        (e.estado IN ('pendiente', 'error') AND e.proxima_ejecucion <= now())
         OR (e.estado = 'procesando' AND e.lease_hasta < now())
      )
      ORDER BY e.proxima_ejecucion, e.id_aplicacion
      FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.ats_evaluaciones_ia e
    SET estado = 'procesando',
        intentos = e.intentos + 1,
        lease_token = gen_random_uuid(),
        lease_hasta = now() + interval '5 minutes',
        actualizado_en = now()
    FROM siguiente s
    WHERE e.id_aplicacion = s.id_aplicacion
    RETURNING e.id_aplicacion, e.lease_token, e.intentos;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_tomar_evaluacion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_tomar_evaluacion() TO service_role;

-- Actualización de resultado y cierre del trabajo en la MISMA transacción PostgreSQL.
CREATE OR REPLACE FUNCTION public.ats_finalizar_evaluacion(
  p_id_aplicacion integer,
  p_lease_token uuid,
  p_puntaje integer,
  p_resumen text,
  p_error_codigo text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_intentos integer;
BEGIN
  SELECT e.intentos INTO v_intentos
    FROM public.ats_evaluaciones_ia e
    WHERE e.id_aplicacion = p_id_aplicacion
      AND e.estado = 'procesando'
      AND e.lease_token = p_lease_token
      AND e.lease_hasta > now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_error_codigo IS NULL THEN
    IF p_puntaje IS NULL OR p_puntaje < 0 OR p_puntaje > 100
       OR p_resumen IS NULL OR length(btrim(p_resumen)) = 0
       OR length(p_resumen) > 1500 THEN
      RAISE EXCEPTION 'Resultado ATS inválido';
    END IF;
    -- No sobrescribir evaluaciones válidas ya registradas por otra ruta.
    UPDATE public.aplicaciones_ats
      SET ai_match_score = p_puntaje, ai_resumen_habilidades = p_resumen
      WHERE id_aplicacion = p_id_aplicacion AND ai_match_score IS NULL;
    UPDATE public.ats_evaluaciones_ia
      SET estado = 'completada', lease_token = NULL, lease_hasta = NULL,
          ultimo_error_codigo = NULL, actualizado_en = now()
      WHERE id_aplicacion = p_id_aplicacion;
  ELSE
    UPDATE public.ats_evaluaciones_ia
      SET estado = CASE WHEN v_intentos >= 3 THEN 'pausada' ELSE 'error' END,
          proxima_ejecucion = now() + make_interval(secs => LEAST(3600, 120 * (2 ^ (v_intentos - 1))::integer)),
          ultimo_error_codigo = left(p_error_codigo, 48),
          lease_token = NULL, lease_hasta = NULL, actualizado_en = now()
      WHERE id_aplicacion = p_id_aplicacion;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_finalizar_evaluacion(integer, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_finalizar_evaluacion(integer, uuid, integer, text, text) TO service_role;

COMMENT ON TABLE public.ats_evaluaciones_ia IS 'Cola transaccional de evaluación IA ATS; los errores no invalidan postulaciones';
COMMIT;
