-- TalentAI 5D (PRUEBAS Resend). Requiere SQL 10, 11, 12.
-- Aislamiento: ninguna notificación puede llegar a Resend sin autorización individual.
-- El destinatario NO reside en esta tabla: lo determina el backend en .env.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.notificaciones_email_intentos') IS NULL OR
     to_regprocedure('public.talentai_reclamar_notificaciones_mock(integer)') IS NULL THEN
    RAISE EXCEPTION 'Ejecuta y valida primero las migraciones 10, 11 y 12';
  END IF;
END $$;

ALTER TABLE public.notificaciones_email
  ADD COLUMN IF NOT EXISTS prueba_resend_autorizada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prueba_resend_autorizada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prueba_resend_autorizada_en timestamptz;

-- Ampliamos catálogo sin alterar registros de pruebas previas.
ALTER TABLE public.notificaciones_email_intentos
  DROP CONSTRAINT IF EXISTS notificaciones_email_intentos_resultado_check;
ALTER TABLE public.notificaciones_email_intentos
  ADD CONSTRAINT notificaciones_email_intentos_resultado_check CHECK (resultado IN (
    'simulado','fallo_transitorio','fallo_permanente','lease_expirado',
    'resend_aceptado','resend_fallo_transitorio','resend_fallo_permanente','resend_incierto'
  ));

CREATE OR REPLACE FUNCTION public.talentai_autorizar_prueba_resend(p_id uuid, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios WHERE id=p_actor AND rol='admin'
  ) THEN RAISE EXCEPTION 'Administrador inválido' USING ERRCODE='42501'; END IF;
  UPDATE public.notificaciones_email n SET
    prueba_resend_autorizada=true,
    prueba_resend_autorizada_por=p_actor,
    prueba_resend_autorizada_en=clock_timestamp(),
    actualizado_en=clock_timestamp()
  WHERE n.id_notificacion=p_id
    AND n.estado IN ('pendiente','fallido')
    AND n.prueba_resend_autorizada=false
    AND n.datos->>'aprobado_envio'='true'
    AND n.datos->>'requiere_aprobacion' IN ('true','false');
  RETURN FOUND;
END;
$fn$;

-- Un solo mensaje por solicitud explícita desde la interfaz.
-- Reapertura de claims vencidos: revisión manual, NUNCA envío automático.
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
      AND n.prueba_resend_autorizada=true
    RETURNING n.id_notificacion, n.intentos
  )
  INSERT INTO public.notificaciones_email_intentos(id_notificacion,resultado,numero_intento,codigo_diagnostico)
  SELECT v.id_notificacion,'lease_expirado',v.intentos,'LEASE_EXPIRED' FROM vencidos v;

  RETURN QUERY
  WITH candidatas AS (
    SELECT n.id_notificacion
    FROM public.notificaciones_email n
    WHERE n.prueba_resend_autorizada=true
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

-- El resultado positivo significa 'aceptado por Resend', NO 'entregado al buzón'.
-- Timeout, 5xx, 409 y resultados incompletos => revisión manual.
CREATE OR REPLACE FUNCTION public.talentai_finalizar_notificacion_resend_prueba(
  p_id uuid, p_token uuid, p_resultado text, p_codigo text, p_id_proveedor text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_intentos integer;
  v_max integer;
  v_estado text;
  v_intento text;
BEGIN
  IF p_resultado NOT IN ('aceptado_proveedor','fallo_transitorio','fallo_permanente','resultado_incierto')
    OR p_codigo NOT IN ('RESEND_ACCEPTED','RESEND_RATE_LIMIT','RESEND_REJECTED','RESEND_UNCERTAIN','RENDER_ERROR')
  THEN RAISE EXCEPTION 'Resultado o diagnóstico inválido' USING ERRCODE='22023'; END IF;

  IF (p_resultado='aceptado_proveedor') <> (p_codigo='RESEND_ACCEPTED') THEN
    RAISE EXCEPTION 'Resultado incongruente' USING ERRCODE='22023';
  END IF;
  IF p_resultado='aceptado_proveedor' THEN
    IF p_id_proveedor IS NULL OR p_id_proveedor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Identificador de Resend inválido' USING ERRCODE='22023';
    END IF;
  ELSIF p_id_proveedor IS NOT NULL THEN
    RAISE EXCEPTION 'No almacenar identificador sin aceptación' USING ERRCODE='22023';
  END IF;

  SELECT n.intentos,n.max_intentos INTO v_intentos,v_max
  FROM public.notificaciones_email n
  WHERE n.id_notificacion=p_id AND n.estado='procesando'
    AND n.prueba_resend_autorizada=true
    AND n.lease_token=p_token AND n.bloqueado_hasta>clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease inválido o vencido' USING ERRCODE='P0002'; END IF;
  v_intentos := least(v_intentos+1,v_max);

  IF p_resultado='aceptado_proveedor' THEN
    v_estado:='aceptado_proveedor'; v_intento:='resend_aceptado';
    UPDATE public.notificaciones_email n SET
      estado=v_estado, intentos=v_intentos, id_mensaje_proveedor=p_id_proveedor,
      enviado_en=clock_timestamp(), ultimo_error=NULL,
      iniciado_en=NULL, lease_token=NULL, bloqueado_hasta=NULL,
      actualizado_en=clock_timestamp()
    WHERE n.id_notificacion=p_id;
  ELSIF p_resultado='resultado_incierto' THEN
    v_estado:='requiere_revision'; v_intento:='resend_incierto';
    UPDATE public.notificaciones_email n SET
      estado=v_estado, intentos=v_intentos, ultimo_error=p_codigo,
      iniciado_en=NULL, lease_token=NULL, bloqueado_hasta=NULL,
      actualizado_en=clock_timestamp()
    WHERE n.id_notificacion=p_id;
  ELSE
    v_estado:='fallido';
    v_intento := CASE WHEN p_resultado='fallo_transitorio' THEN
      'resend_fallo_transitorio' ELSE 'resend_fallo_permanente' END;
    UPDATE public.notificaciones_email n SET
      estado=v_estado, intentos=v_intentos, ultimo_error=p_codigo,
      proximo_intento_en=CASE WHEN p_resultado='fallo_transitorio' THEN
        clock_timestamp()+(least(3600,60*power(2::numeric,least(v_intentos-1,6)))::double precision*interval '1 second')
        ELSE clock_timestamp()+interval '1 day' END,
      iniciado_en=NULL, lease_token=NULL, bloqueado_hasta=NULL,
      actualizado_en=clock_timestamp()
    WHERE n.id_notificacion=p_id;
  END IF;
  INSERT INTO public.notificaciones_email_intentos(id_notificacion,resultado,numero_intento,codigo_diagnostico)
  VALUES(p_id,v_intento,v_intentos,p_codigo);
  RETURN v_estado;
END;
$fn$;

-- Importante: bloquear la reprogramación ciega de envíos Resend inciertos.
-- Para revisar debe verificarse el ID de la solicitud en el panel de Resend.
CREATE OR REPLACE FUNCTION public.talentai_reprogramar_notificacion(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  UPDATE public.notificaciones_email n SET
    estado='pendiente', proximo_intento_en=clock_timestamp(),
    actualizado_en=clock_timestamp(), ultimo_error=NULL,
    lease_token=NULL, bloqueado_hasta=NULL
  WHERE n.id_notificacion=p_id
    AND n.estado IN ('fallido','requiere_revision')
    AND n.intentos < n.max_intentos
    AND NOT (n.estado='requiere_revision' AND n.prueba_resend_autorizada=true);
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.talentai_autorizar_prueba_resend(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_resend_prueba(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_autorizar_prueba_resend(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_resend_prueba(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text) TO service_role;
-- Procedimiento ya existente en 5C: conserva privilegios service_role.
REVOKE ALL ON FUNCTION public.talentai_reprogramar_notificacion(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_reprogramar_notificacion(uuid) TO service_role;

COMMENT ON COLUMN public.notificaciones_email.prueba_resend_autorizada IS
 'Opt-in POR NOTIFICACION requerido antes de utilizar Resend de prueba. Default false; histórico no se envía.';
COMMENT ON FUNCTION public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text) IS
 'La aceptación por proveedor NO confirma la entrega al destinatario.';
NOTIFY pgrst,'reload schema';
COMMIT;
