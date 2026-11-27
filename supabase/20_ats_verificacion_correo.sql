-- TalentAI v2.0 · Cierre 02: comprobación de titularidad de correo para POST público ATS.
-- DEPENDENCIAS: 04 (índice único lower(correo)), 06 (unicidad candidato-vacante),
-- 11 (notificaciones ATS), 18 (evaluación diferida). Requiere backend service_role.
-- Esta migración NO modifica ninguna candidatura anterior, ni envía correos.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.candidatos') IS NULL
     OR to_regclass('public.aplicaciones_ats') IS NULL
     OR to_regclass('public.ats_evaluaciones_ia') IS NULL THEN
    RAISE EXCEPTION 'Dependencias ATS incompletas. Aplica primero las migraciones hasta 19.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
    AND indexname = 'ux_candidatos_correo_lower'
  ) THEN
    RAISE EXCEPTION 'Falta el índice ux_candidatos_correo_lower (migración 04).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ats_verificaciones_correo (
  correo text PRIMARY KEY,
  codigo_hash text,
  expira_en timestamptz,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 5),
  solicitudes_24h integer NOT NULL DEFAULT 0 CHECK (solicitudes_24h >= 0),
  ventana_inicio timestamptz,
  ultimo_envio_en timestamptz,
  consumido_en timestamptz,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ats_verificacion_hash_formato CHECK (codigo_hash IS NULL OR codigo_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS ix_ats_verificaciones_limpieza
  ON public.ats_verificaciones_correo (actualizado_en);
ALTER TABLE public.ats_verificaciones_correo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ats_verificaciones_correo FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ats_verificaciones_correo TO service_role;

-- Una fila por correo + FOR UPDATE: las solicitudes simultáneas no saltan el cooldown.
-- Retorna false de manera indistinguible para enfriamiento o límite diario.
CREATE OR REPLACE FUNCTION public.ats_iniciar_verificacion_correo(
  p_correo text, p_codigo_hash text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  v_correo text := lower(btrim(p_correo));
  v_fila public.ats_verificaciones_correo%ROWTYPE;
  v_ahora timestamptz := clock_timestamp();
BEGIN
  IF length(v_correo) > 254 OR length(v_correo) < 3
     OR p_codigo_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;

  INSERT INTO public.ats_verificaciones_correo (correo)
  VALUES (v_correo) ON CONFLICT (correo) DO NOTHING;
  SELECT * INTO v_fila FROM public.ats_verificaciones_correo
    WHERE correo = v_correo FOR UPDATE;
  IF v_fila.ultimo_envio_en IS NOT NULL
     AND v_fila.ultimo_envio_en > v_ahora - interval '90 seconds' THEN
    RETURN false;
  END IF;
  IF v_fila.ventana_inicio > v_ahora - interval '24 hours'
     AND v_fila.solicitudes_24h >= 5 THEN
    RETURN false;
  END IF;
  UPDATE public.ats_verificaciones_correo
  SET codigo_hash = p_codigo_hash,
      expira_en = v_ahora + interval '10 minutes',
      intentos = 0,
      consumido_en = NULL,
      solicitudes_24h = CASE WHEN v_fila.ventana_inicio > v_ahora - interval '24 hours'
        THEN v_fila.solicitudes_24h + 1 ELSE 1 END,
      ventana_inicio = CASE WHEN v_fila.ventana_inicio > v_ahora - interval '24 hours'
        THEN v_fila.ventana_inicio ELSE v_ahora END,
      ultimo_envio_en = v_ahora,
      actualizado_en = v_ahora
  WHERE correo = v_correo;
  RETURN true;
END;
$fn$;

-- Si Resend rechaza explícitamente el envío, invalidar ese código en particular.
CREATE OR REPLACE FUNCTION public.ats_cancelar_verificacion_correo(
  p_correo text, p_codigo_hash text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  UPDATE public.ats_verificaciones_correo SET
    codigo_hash = NULL, expira_en = NULL, actualizado_en = now()
  WHERE correo = lower(btrim(p_correo)) AND codigo_hash = p_codigo_hash;
$fn$;

-- Validación y creación de candidatura ATÓMICAS. El código solo se consume si
-- existe una aplicación ATS nueva; cualquier fallo de SQL revierte la transacción.
-- No permite cambiar datos del candidato preexistente sin otra autorización.
CREATE OR REPLACE FUNCTION public.ats_confirmar_postulacion_verificada(
  p_correo text,
  p_codigo_hash text,
  p_nombre text,
  p_telefono text,
  p_linkedin text,
  p_id_vacante integer,
  p_cv_path text
) RETURNS TABLE(resultado text, id_aplicacion integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  v_correo text := lower(btrim(p_correo));
  v_fila public.ats_verificaciones_correo%ROWTYPE;
  v_id_candidato integer;
  v_id_aplicacion integer;
  v_ahora timestamptz := clock_timestamp();
BEGIN
  IF length(v_correo) > 254 OR length(v_correo) < 3
     OR p_codigo_hash !~ '^[a-f0-9]{64}$'
     OR btrim(coalesce(p_nombre,'')) = '' OR length(p_nombre) > 120
     OR length(coalesce(p_telefono,'')) > 40
     OR length(coalesce(p_linkedin,'')) > 300
     OR p_id_vacante IS NULL OR p_id_vacante <= 0
     OR p_cv_path IS NULL OR p_cv_path !~ '^cv_[0-9a-f-]{36}_[a-z0-9._-]+\.pdf$' THEN
    RETURN QUERY SELECT 'solicitud_invalida'::text, NULL::integer; RETURN;
  END IF;
  SELECT * INTO v_fila FROM public.ats_verificaciones_correo
    WHERE correo = v_correo FOR UPDATE;
  IF NOT FOUND OR v_fila.codigo_hash IS NULL OR v_fila.consumido_en IS NOT NULL THEN
    RETURN QUERY SELECT 'codigo_invalido'::text, NULL::integer; RETURN;
  END IF;
  IF v_fila.expira_en <= v_ahora THEN
    RETURN QUERY SELECT 'codigo_expirado'::text, NULL::integer; RETURN;
  END IF;
  IF v_fila.intentos >= 5 THEN
    RETURN QUERY SELECT 'codigo_bloqueado'::text, NULL::integer; RETURN;
  END IF;
  IF v_fila.codigo_hash <> p_codigo_hash THEN
    UPDATE public.ats_verificaciones_correo
    SET intentos = intentos + 1, actualizado_en = v_ahora WHERE correo = v_correo;
    RETURN QUERY SELECT 'codigo_invalido'::text, NULL::integer; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vacantes
    WHERE id_vacante = p_id_vacante AND estado = 'Activa') THEN
    RETURN QUERY SELECT 'vacante_inactiva'::text, NULL::integer; RETURN;
  END IF;

  -- Idempotencia de candidatos por lower(correo); serializar por challenge.
  SELECT c.id_candidato INTO v_id_candidato FROM public.candidatos c
    WHERE lower(c.correo) = v_correo LIMIT 1 FOR UPDATE;
  IF v_id_candidato IS NULL THEN
    BEGIN
      INSERT INTO public.candidatos (nombre, correo, telefono, enlace_linkedin)
      VALUES (btrim(p_nombre), v_correo, nullif(btrim(p_telefono), ''), nullif(btrim(p_linkedin), ''))
      RETURNING public.candidatos.id_candidato INTO v_id_candidato;
    EXCEPTION WHEN unique_violation THEN
      SELECT c.id_candidato INTO v_id_candidato FROM public.candidatos c
        WHERE lower(c.correo) = v_correo LIMIT 1 FOR UPDATE;
      IF v_id_candidato IS NULL THEN RAISE; END IF;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM public.aplicaciones_ats a
    WHERE a.id_candidato = v_id_candidato AND a.id_vacante = p_id_vacante) THEN
    RETURN QUERY SELECT 'ya_postulado'::text, NULL::integer; RETURN;
  END IF;

  BEGIN
    INSERT INTO public.aplicaciones_ats (
      id_candidato, id_vacante, estado_proceso, ai_match_score,
      ai_resumen_habilidades, url_archivo_cv
    ) VALUES (v_id_candidato, p_id_vacante, 'Recibida', NULL, NULL, p_cv_path)
    RETURNING public.aplicaciones_ats.id_aplicacion INTO v_id_aplicacion;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'ya_postulado'::text, NULL::integer; RETURN;
  END;

  -- Solo después de guardar la candidatura se consume el código.
  UPDATE public.ats_verificaciones_correo
  SET codigo_hash = NULL, expira_en = NULL, consumido_en = v_ahora,
      actualizado_en = v_ahora
  WHERE correo = v_correo;

  RETURN QUERY SELECT 'creada'::text, v_id_aplicacion;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ats_iniciar_verificacion_correo(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ats_cancelar_verificacion_correo(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ats_confirmar_postulacion_verificada(text, text, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_iniciar_verificacion_correo(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ats_cancelar_verificacion_correo(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ats_confirmar_postulacion_verificada(text, text, text, text, text, integer, text)
  TO service_role;
-- Retención mínima: conservar hasta 48h para proteger el límite de 24h;
-- purgar periódicamente desde un proceso administrativo programado.
CREATE OR REPLACE FUNCTION public.ats_purgar_verificaciones_correo()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_eliminadas integer;
BEGIN
  DELETE FROM public.ats_verificaciones_correo
    WHERE actualizado_en < now() - interval '48 hours';
  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
  RETURN v_eliminadas;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_purgar_verificaciones_correo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_purgar_verificaciones_correo() TO service_role;

COMMENT ON TABLE public.ats_verificaciones_correo IS
  'OTP ATS de vida corta, con HMAC no reversible; sin exponer códigos ni información de candidatos. Purga programable.';
COMMIT;
