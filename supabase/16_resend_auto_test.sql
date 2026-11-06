-- TalentAI Fase 8A — DESPACHO AUTOMATICO EXCLUSIVAMENTE DE PRUEBAS RESEND.
-- Requiere SQL 10-13. No modifica destinatarios, no envia emails desde PostgreSQL.
-- Ejecutar antes de habilitar RESEND_AUTO_ENABLED en Express.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.notificaciones_email') IS NULL OR
    to_regclass('public.notificaciones_email_intentos') IS NULL OR
    to_regprocedure('public.talentai_reclamar_notificaciones_resend_prueba(integer)') IS NULL OR
    to_regprocedure('public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text)') IS NULL THEN
   RAISE EXCEPTION 'Primero aplica y valida las fases 5A-5D (SQL 10-13).';
 END IF;
END $$;

-- NUEVO permiso para el trabajador. Nunca se migra el permiso antiguo de Fase 5D.
ALTER TABLE public.notificaciones_email
  ADD COLUMN IF NOT EXISTS auto_resend_autorizado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_resend_autorizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_resend_autorizado_en timestamptz;
CREATE INDEX IF NOT EXISTS idx_notificaciones_resend_auto_elegibles
  ON public.notificaciones_email(auto_resend_autorizado_en,proximo_intento_en)
  WHERE auto_resend_autorizado=true AND estado IN ('pendiente','fallido');

-- Registro de RESERVAS, no de entregas. Limite diario compartido aun con varios Express.
-- ON DELETE SET NULL conserva el conteo del dia si la candidatura se elimina.
-- Sin direcciones de email, cuerpo, plantillas ni credenciales.
CREATE TABLE IF NOT EXISTS public.notificaciones_resend_auto_reservas (
  lease_token uuid PRIMARY KEY,
  id_notificacion uuid REFERENCES public.notificaciones_email(id_notificacion) ON DELETE SET NULL,
  reservado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_resend_auto_dia
  ON public.notificaciones_resend_auto_reservas(reservado_en DESC);
ALTER TABLE public.notificaciones_resend_auto_reservas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_resend_auto_reservas FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON public.notificaciones_resend_auto_reservas TO service_role;

-- Cada administrador debe autorizar 5D Y, separadamente, el envio automatico 8A.
-- No se autorizan lotes, no se hace backfill y los permisos anteriores siguen en FALSE.
CREATE OR REPLACE FUNCTION public.talentai_autorizar_auto_resend(p_id uuid,p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios WHERE id=p_actor AND rol='admin'
  ) THEN RAISE EXCEPTION 'Administrador invalido' USING ERRCODE='42501'; END IF;
  UPDATE public.notificaciones_email n SET
    auto_resend_autorizado=true,
    auto_resend_autorizado_por=p_actor,
    auto_resend_autorizado_en=clock_timestamp(),
    actualizado_en=clock_timestamp()
  WHERE n.id_notificacion=p_id
    AND n.estado='pendiente'
    AND n.prueba_resend_autorizada=true
    AND n.auto_resend_autorizado=false
    AND n.id_mensaje_proveedor IS NULL
    AND n.intentos < n.max_intentos
    AND n.datos->>'aprobado_envio'='true'
    AND n.datos->>'requiere_aprobacion' IN ('true','false');
  RETURN FOUND;
END;
$fn$;

-- Desarmar: no se permite desarmar una fila ya reclamada (estado procesando).
CREATE OR REPLACE FUNCTION public.talentai_revocar_auto_resend(p_id uuid,p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios WHERE id=p_actor AND rol='admin'
  ) THEN RAISE EXCEPTION 'Administrador invalido' USING ERRCODE='42501'; END IF;
  UPDATE public.notificaciones_email n SET
    auto_resend_autorizado=false, actualizado_en=clock_timestamp()
  WHERE n.id_notificacion=p_id
    AND n.auto_resend_autorizado=true
    AND n.estado IN ('pendiente','fallido');
  RETURN FOUND;
END;
$fn$;

-- Reclamo de una sola fila, con tope diario transaccional (UTC) a nivel BD.
-- Al contar RESERVAS antes de cualquier llamada HTTP, incluso los fallos ambiguos
-- cuentan contra el limite del dia. El registro de cada reserva es atomico.
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

REVOKE ALL ON FUNCTION public.talentai_autorizar_auto_resend(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_revocar_auto_resend(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_autorizar_auto_resend(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_revocar_auto_resend(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer) TO service_role;

COMMENT ON COLUMN public.notificaciones_email.auto_resend_autorizado IS
  'Fase 8A: autorizacion nueva e individual. DEFAULT false; no hereda permisos de 5D.';
COMMENT ON TABLE public.notificaciones_resend_auto_reservas IS
  'Reservas del trabajador automatizado. Una reserva contabiliza una llamada potencial, no una entrega.';
NOTIFY pgrst,'reload schema';
COMMIT;
