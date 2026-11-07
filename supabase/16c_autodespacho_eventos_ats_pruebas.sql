-- ============================================================================
-- TalentAI 8A.2 (SQL 16c): autorización AUTOMÁTICA POR EVENTO ATS (SOLO PRUEBAS).
-- Requisitos: SQL 10-13, 16 y corrección 16b.
-- PELIGRO CONTROLADO: NO activa el envío al ejecutar la migración.
-- El destino sigue siendo EXCLUSIVAMENTE RESEND_TEST_TO verificado en Express.
-- No reautoriza correos antiguos, no hace backfill y no envía desde SQL.
-- ============================================================================
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.notificaciones_email') IS NULL
     OR to_regclass('public.notificaciones_resend_auto_reservas') IS NULL
     OR to_regprocedure('public.talentai_reclamar_notificaciones_resend_auto(integer)') IS NULL
     OR to_regprocedure('public.talentai_reclamar_notificaciones_resend_prueba(integer)') IS NULL
     OR to_regprocedure('public.talentai_aprobar_notificacion(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltan dependencias: ejecutar y validar Fases 5A-5D, 8A y SQL 16b.';
  END IF;
END $$;

-- Política de activación única: por defecto APAGADA. Versiones irrepetibles
-- evitan que una reactivación remita pendientes de una sesión anterior.
CREATE TABLE IF NOT EXISTS public.notificaciones_auto_ats_politica (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  habilitado boolean NOT NULL DEFAULT false,
  version_actual uuid NOT NULL DEFAULT gen_random_uuid(),
  habilitado_en timestamptz,
  habilitado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.notificaciones_auto_ats_politica (id,habilitado)
VALUES (1,false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.notificaciones_auto_ats_politica ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_auto_ats_politica FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.notificaciones_auto_ats_politica TO service_role;

-- ADMIN: habilitar una vez, o pausar la política. Revoca SOLO las autorizaciones
-- automáticas PENDIENTES propias de la política, jamás sobrescribe las manuales.
CREATE OR REPLACE FUNCTION public.talentai_configurar_autodespacho_ats(
  p_habilitado boolean, p_actor uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_antes boolean;
BEGIN
  IF p_habilitado IS NULL OR p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id=p_actor AND u.rol='admin'
  ) THEN
    RAISE EXCEPTION 'Acceso o configuración inválida' USING ERRCODE='42501';
  END IF;
  SELECT p.habilitado INTO v_antes FROM public.notificaciones_auto_ats_politica p WHERE p.id=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Política inexistente'; END IF;
  IF p_habilitado AND NOT v_antes THEN
    UPDATE public.notificaciones_auto_ats_politica p SET
      habilitado=true, version_actual=gen_random_uuid(),
      habilitado_en=clock_timestamp(), habilitado_por=p_actor,
      actualizado_en=clock_timestamp()
    WHERE p.id=1;
  ELSIF NOT p_habilitado AND v_antes THEN
    UPDATE public.notificaciones_auto_ats_politica p SET
      habilitado=false,actualizado_en=clock_timestamp()
    WHERE p.id=1;
    -- Los eventos ya procesados son inmutables. Los que siguen pendientes
    -- dejan de estar armados; los reclamos en curso requieren auditoría.
    UPDATE public.notificaciones_email n SET
      auto_resend_autorizado=false,auto_resend_autorizado_en=NULL,
      prueba_resend_autorizada=false,prueba_resend_autorizada_en=NULL,
      actualizado_en=clock_timestamp()
    WHERE n.datos ? 'auto_ats_version'
      AND n.auto_resend_autorizado_por IS NULL
      AND n.prueba_resend_autorizada_por IS NULL
      AND n.estado IN ('pendiente','fallido')
      AND n.id_mensaje_proveedor IS NULL;
  END IF;
  RETURN true;
END;
$fn$;

-- BEFORE INSERT: funciona tanto para postulación en Careers como para
-- transiciones ATS porque ambos flujos ya pasan por el trigger de Fase 5B.
-- AFTER de aprobación administrativa (BEFORE UPDATE): activar Contratado/Descartado
-- SIN segunda autorización individual de Resend.
CREATE OR REPLACE FUNCTION public.talentai_preparar_autodespacho_evento_ats()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_version uuid; v_ahora timestamptz;
BEGIN
  SELECT p.version_actual INTO v_version
  FROM public.notificaciones_auto_ats_politica p
  WHERE p.id=1 AND p.habilitado=true;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.estado<>'pendiente' OR NEW.id_aplicacion IS NULL
      OR NEW.prueba_resend_autorizada=true OR NEW.auto_resend_autorizado=true
      OR coalesce(NEW.datos->>'origen','') NOT IN ('creacion_aplicacion','cambio_estado')
    THEN RETURN NEW; END IF;
    IF NEW.tipo_evento='postulacion_recibida' THEN
      IF coalesce(NEW.datos->>'origen','')<>'creacion_aplicacion' THEN RETURN NEW; END IF;
    ELSIF NEW.tipo_evento IN ('en_revision','entrevista','contratado','descartado') THEN
      IF coalesce(NEW.datos->>'origen','')<>'cambio_estado' THEN RETURN NEW; END IF;
    ELSE RETURN NEW; END IF;

    -- Sello exclusivo de eventos NUEVOS mientras la política está habilitada.
    NEW.datos := jsonb_set(NEW.datos,'{auto_ats_version}',to_jsonb(v_version::text),true);
    -- Terminales NO se arman hasta que un administrador apruebe la decisión.
    IF NEW.tipo_evento IN ('postulacion_recibida','en_revision','entrevista')
      AND NEW.datos->>'requiere_aprobacion'='false'
      AND NEW.datos->>'aprobado_envio'='true' THEN
      v_ahora:=clock_timestamp();
      NEW.prueba_resend_autorizada:=true;
      NEW.prueba_resend_autorizada_en:=v_ahora;
      NEW.auto_resend_autorizado:=true;
      NEW.auto_resend_autorizado_en:=v_ahora;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' AND NEW.tipo_evento IN ('contratado','descartado')
    AND NEW.estado='pendiente'
    AND OLD.datos->>'aprobado_envio'='false'
    AND NEW.datos->>'aprobado_envio'='true'
    AND NEW.datos->>'requiere_aprobacion'='true'
    AND NEW.aprobado_por IS NOT NULL
    AND NEW.datos->>'auto_ats_version'=v_version::text
    AND NOT NEW.auto_resend_autorizado THEN
    v_ahora:=clock_timestamp();
    NEW.prueba_resend_autorizada:=true;
    NEW.prueba_resend_autorizada_en:=v_ahora;
    NEW.auto_resend_autorizado:=true;
    NEW.auto_resend_autorizado_en:=v_ahora;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_talentai_preparar_autodespacho_insert ON public.notificaciones_email;
CREATE TRIGGER trg_talentai_preparar_autodespacho_insert
BEFORE INSERT ON public.notificaciones_email
FOR EACH ROW EXECUTE FUNCTION public.talentai_preparar_autodespacho_evento_ats();
DROP TRIGGER IF EXISTS trg_talentai_preparar_autodespacho_aprobacion ON public.notificaciones_email;
CREATE TRIGGER trg_talentai_preparar_autodespacho_aprobacion
BEFORE UPDATE OF datos,aprobado_por ON public.notificaciones_email
FOR EACH ROW EXECUTE FUNCTION public.talentai_preparar_autodespacho_evento_ats();

-- Reutilizamos EXACTAMENTE el reclamo 8A (lease de 2 min, SKIP LOCKED,
-- advisory lock, tope diario UTC), pero con condición anti-replay por versión.
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
      -- Eventos originados por la política solo pueden salir durante SU activación vigente.
      -- Nunca se despachan filas antiguas al reactivar la política.
      AND (
        NOT (n.datos ? 'auto_ats_version')
        OR EXISTS (
          SELECT 1 FROM public.notificaciones_auto_ats_politica p
          WHERE p.id=1 AND p.habilitado=true
            AND p.version_actual::text=n.datos->>'auto_ats_version'
        )
      )
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


-- El botón 5D de envío MANUAL no debe reclamar trabajos del trabajador 8A.
CREATE OR REPLACE FUNCTION public.talentai_reclamar_notificaciones_resend_prueba(p_limite integer DEFAULT 1)
RETURNS TABLE(id_notificacion uuid, lease_token uuid, tipo_evento varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF p_limite IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Solo se admite un correo de prueba por operación' USING ERRCODE='22023';
  END IF;
  WITH vencidos AS (
    UPDATE public.notificaciones_email n
    SET estado='requiere_revision', lease_token=NULL, bloqueado_hasta=NULL,
        ultimo_error='LEASE_EXPIRED', actualizado_en=clock_timestamp()
    WHERE n.estado='procesando' AND n.bloqueado_hasta < clock_timestamp()
      AND n.prueba_resend_autorizada=true AND n.auto_resend_autorizado=false
    RETURNING n.id_notificacion, n.intentos
  )
  INSERT INTO public.notificaciones_email_intentos(id_notificacion,resultado,numero_intento,codigo_diagnostico)
  SELECT v.id_notificacion,'lease_expirado',v.intentos,'LEASE_EXPIRED' FROM vencidos v;

  RETURN QUERY
  WITH candidatas AS (
    SELECT n.id_notificacion
    FROM public.notificaciones_email n
    WHERE n.prueba_resend_autorizada=true
      AND n.auto_resend_autorizado=false -- El botón manual no evade la cuota del worker.
      AND n.id_mensaje_proveedor IS NULL
      AND n.estado IN ('pendiente','fallido')
      AND n.proximo_intento_en <= clock_timestamp()
      AND n.intentos < n.max_intentos
      AND n.datos->>'aprobado_envio'='true'
      AND n.datos->>'requiere_aprobacion' IN ('true','false')
    ORDER BY n.prueba_resend_autorizada_en ASC, n.creado_en ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.notificaciones_email n SET
    estado='procesando', iniciado_en=clock_timestamp(),
    bloqueado_hasta=clock_timestamp()+interval '2 minutes',
    lease_token=gen_random_uuid(), actualizado_en=clock_timestamp()
  FROM candidatas c
  WHERE n.id_notificacion=c.id_notificacion
  RETURNING n.id_notificacion, n.lease_token, n.tipo_evento;
END;
$fn$;


REVOKE ALL ON FUNCTION public.talentai_configurar_autodespacho_ats(boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_preparar_autodespacho_evento_ats() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_resend_prueba(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_configurar_autodespacho_ats(boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_resend_auto(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_resend_prueba(integer) TO service_role;
COMMENT ON TABLE public.notificaciones_auto_ats_politica IS
 'Política global por evento ATS. Solo habilitable por admin; apagada por defecto. No reenvía eventos antiguos.';
COMMENT ON COLUMN public.notificaciones_email.auto_resend_autorizado IS
 'Fase 8A: opt-in por fila manual o activación de política ATS 16c para eventos posteriores.';
NOTIFY pgrst,'reload schema';
COMMIT;
