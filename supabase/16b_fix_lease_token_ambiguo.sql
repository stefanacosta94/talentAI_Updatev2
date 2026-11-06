-- TalentAI Fase 8A - HOTFIX SQLSTATE 42702 / lease_token ambiguo.
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor, luego verificar con 16b_verify_resend_auto_fix.sql.
-- No elimina datos, no modifica permisos, no envia correos ni autoriza eventos.
-- Sustituye exclusivamente la definicion del RPC instalado por SQL 16.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.talentai_reclamar_notificaciones_resend_auto(integer)') IS NULL
     OR to_regclass('public.notificaciones_resend_auto_reservas') IS NULL THEN
    RAISE EXCEPTION 'Fase 8A SQL 16 debe estar instalada antes de aplicar el hotfix';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.talentai_reclamar_notificaciones_resend_auto(
  p_max_diario integer DEFAULT 5
)
RETURNS TABLE(id_notificacion uuid,lease_token uuid,tipo_evento varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  IF p_max_diario IS NULL OR p_max_diario NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Limite diario fuera del rango 1-20' USING ERRCODE='22023';
  END IF;
  -- La barrera advisory evita carreras al comprobar el limite entre procesos.
  IF NOT pg_try_advisory_xact_lock(81621016) THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.notificaciones_resend_auto_reservas a
      WHERE (a.reservado_en AT TIME ZONE 'UTC')::date =
            (clock_timestamp() AT TIME ZONE 'UTC')::date) >= p_max_diario THEN
    RETURN;
  END IF;

  -- Leases expuestos a llamadas HTTPS ambiguas: jamas auto-reintentar.
  WITH vencidos AS (
    UPDATE public.notificaciones_email n SET
      estado='requiere_revision',lease_token=NULL,bloqueado_hasta=NULL,
      ultimo_error='LEASE_EXPIRED', actualizado_en=clock_timestamp()
    WHERE n.auto_resend_autorizado=true AND n.prueba_resend_autorizada=true
      AND n.estado='procesando' AND n.bloqueado_hasta<clock_timestamp()
    RETURNING n.id_notificacion,n.intentos
  )
  INSERT INTO public.notificaciones_email_intentos(id_notificacion,resultado,numero_intento,codigo_diagnostico)
  SELECT v.id_notificacion,'lease_expirado',v.intentos,'LEASE_EXPIRED' FROM vencidos v;

  RETURN QUERY
  WITH candidatas AS (
    SELECT n.id_notificacion
    FROM public.notificaciones_email n
    WHERE n.auto_resend_autorizado=true
      AND n.prueba_resend_autorizada=true
      AND n.auto_resend_autorizado_en IS NOT NULL
      AND n.estado IN ('pendiente','fallido')
      AND n.proximo_intento_en<=clock_timestamp()
      AND n.intentos<n.max_intentos
      AND n.id_mensaje_proveedor IS NULL
      -- Reintentar solo rechazos inequívocos de cuota 429, nunca 401/HTML.
      AND (n.estado='pendiente' OR n.ultimo_error='RESEND_RATE_LIMIT')
      AND n.datos->>'aprobado_envio'='true'
      AND n.datos->>'requiere_aprobacion' IN ('true','false')
    ORDER BY n.auto_resend_autorizado_en,n.creado_en
    FOR UPDATE SKIP LOCKED LIMIT 1
  ), reservadas AS (
    UPDATE public.notificaciones_email n SET
      estado='procesando',iniciado_en=clock_timestamp(),
      bloqueado_hasta=clock_timestamp()+interval '2 minutes',
      lease_token=gen_random_uuid(),actualizado_en=clock_timestamp()
    FROM candidatas c
    WHERE n.id_notificacion=c.id_notificacion
    RETURNING n.id_notificacion,n.lease_token,n.tipo_evento
  ), contabilizadas AS (
    INSERT INTO public.notificaciones_resend_auto_reservas AS reserva(lease_token,id_notificacion)
    SELECT r.lease_token,r.id_notificacion FROM reservadas r
    RETURNING reserva.lease_token
  )
  SELECT r.id_notificacion,r.lease_token,r.tipo_evento FROM reservadas r
  JOIN contabilizadas c ON c.lease_token=r.lease_token;
END;
$fn$;

-- Mantener los mismos permisos de ejecucion; no conceder acceso publico.
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
