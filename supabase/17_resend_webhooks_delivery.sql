-- ============================================================================
-- TalentAI Fase 8B: recepción verificada de eventos Resend / Svix.
-- PRECONDICIÓN: SQL 10, 13, 16b y 16c instalados y validados.
-- Ejecutar UNA VEZ desde SQL Editor. No envía correos, no altera permisos ATS,
-- no reprocesa notificaciones históricas ni cambia su estado de despacho.
-- ============================================================================
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.notificaciones_email') IS NULL OR
     to_regprocedure('public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta cola Resend de Fases 5D/8A: aplícala antes de SQL 17.';
  END IF;
END $$;

ALTER TABLE public.notificaciones_email
  ADD COLUMN IF NOT EXISTS entrega_estado varchar(32),
  ADD COLUMN IF NOT EXISTS entrega_evento_en timestamptz,
  ADD COLUMN IF NOT EXISTS entrega_verificado_en timestamptz;

ALTER TABLE public.notificaciones_email
  DROP CONSTRAINT IF EXISTS notificaciones_email_entrega_estado_check;
ALTER TABLE public.notificaciones_email
  ADD CONSTRAINT notificaciones_email_entrega_estado_check CHECK (
    entrega_estado IS NULL OR entrega_estado IN (
      'en_transito','demorado','entregado','rebotado','reclamo','fallo_entrega','suprimido'
    )
  );
COMMENT ON COLUMN public.notificaciones_email.entrega_estado IS
  'Confirmación independiente del despacho. Entregado significa aceptación por servidor destinatario; no confirma lectura ni bandeja de entrada.';

-- Inbox mínimo, privado e idempotente: NO almacenar correo, asunto, payload,
-- IP, identidad del candidato, datos personales ni cabeceras firmadas.
CREATE TABLE IF NOT EXISTS public.notificaciones_resend_webhook_eventos (
  id_evento varchar(128) PRIMARY KEY,
  id_mensaje_proveedor varchar(64) NOT NULL,
  tipo varchar(32) NOT NULL CHECK (tipo IN (
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed'
  )),
  ocurrido_en timestamptz NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  id_notificacion uuid REFERENCES public.notificaciones_email(id_notificacion) ON DELETE SET NULL,
  procesado boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_email_pendiente
  ON public.notificaciones_resend_webhook_eventos (id_mensaje_proveedor, ocurrido_en)
  WHERE procesado=false;
CREATE INDEX IF NOT EXISTS idx_resend_webhook_notificacion
  ON public.notificaciones_resend_webhook_eventos (id_notificacion, ocurrido_en DESC);
ALTER TABLE public.notificaciones_resend_webhook_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notificaciones_resend_webhook_eventos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.notificaciones_resend_webhook_eventos TO service_role;
-- La única escritura normal ocurre por la función SECURITY DEFINER.

-- Correlacionar un evento previamente autenticado por Express con su ID Resend.
-- Bloquea la notificación, pero NO cambia n.estado, idempotencia, intentos ni cola.
CREATE OR REPLACE FUNCTION public.talentai_aplicar_evento_webhook_resend(p_evento_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
  v_evento public.notificaciones_resend_webhook_eventos%ROWTYPE;
  v_id uuid;
  v_duplicados integer;
  v_nuevo text;
  v_rango_nuevo integer;
BEGIN
  SELECT e.* INTO v_evento FROM public.notificaciones_resend_webhook_eventos e
    WHERE e.id_evento=p_evento_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_evento.procesado THEN RETURN true; END IF;

  SELECT n.id_notificacion INTO v_id FROM public.notificaciones_email n
    WHERE n.id_mensaje_proveedor=v_evento.id_mensaje_proveedor
      AND n.estado='aceptado_proveedor'
    ORDER BY n.id_notificacion LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT count(*) INTO v_duplicados FROM public.notificaciones_email n
    WHERE n.id_mensaje_proveedor=v_evento.id_mensaje_proveedor
      AND n.estado='aceptado_proveedor';
  IF v_duplicados <> 1 THEN RETURN false; END IF;

  v_nuevo := CASE v_evento.tipo
    WHEN 'email.sent' THEN 'en_transito'
    WHEN 'email.delivered' THEN 'entregado'
    WHEN 'email.delivery_delayed' THEN 'demorado'
    WHEN 'email.bounced' THEN 'rebotado'
    WHEN 'email.complained' THEN 'reclamo'
    WHEN 'email.failed' THEN 'fallo_entrega'
    WHEN 'email.suppressed' THEN 'suprimido'
  END;
  v_rango_nuevo := CASE v_nuevo
    WHEN 'en_transito' THEN 1 WHEN 'demorado' THEN 2 WHEN 'entregado' THEN 3
    WHEN 'fallo_entrega' THEN 4 WHEN 'rebotado' THEN 5
    WHEN 'suprimido' THEN 6 WHEN 'reclamo' THEN 7 ELSE 0 END;

  UPDATE public.notificaciones_email n SET
    entrega_estado=v_nuevo,
    entrega_evento_en=v_evento.ocurrido_en,
    entrega_verificado_en=clock_timestamp(),
    actualizado_en=clock_timestamp()
  WHERE n.id_notificacion=v_id AND n.estado='aceptado_proveedor'
    -- Nunca convertir un rebote/supresión/reclamo en 'entregado' o 'demorado'.
    AND NOT (n.entrega_estado IN ('rebotado','reclamo','suprimido','fallo_entrega')
             AND v_nuevo IN ('en_transito','demorado','entregado'))
    AND NOT (n.entrega_estado='entregado' AND v_nuevo IN ('en_transito','demorado'))
    -- Evitar degradar por eventos retrasados o replays viejos.
    AND (n.entrega_evento_en IS NULL OR v_evento.ocurrido_en > n.entrega_evento_en
      OR (v_evento.ocurrido_en = n.entrega_evento_en AND
        v_rango_nuevo > CASE n.entrega_estado
          WHEN 'en_transito' THEN 1 WHEN 'demorado' THEN 2 WHEN 'entregado' THEN 3
          WHEN 'fallo_entrega' THEN 4 WHEN 'rebotado' THEN 5
          WHEN 'suprimido' THEN 6 WHEN 'reclamo' THEN 7 ELSE 0 END));

  -- Un evento válido más antiguo puede quedar correlacionado sin modificar estado.
  UPDATE public.notificaciones_resend_webhook_eventos e SET
    procesado=true,id_notificacion=v_id
  WHERE e.id_evento=p_evento_id AND e.procesado=false;
  RETURN true;
END;
$fn$;

-- Persistencia atómica e idempotente por svix-id (no por email_id).
CREATE OR REPLACE FUNCTION public.talentai_registrar_webhook_resend(
  p_evento_id text, p_id_mensaje text, p_tipo text, p_ocurrido_en timestamptz
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_insertado integer; v_aplicado boolean;
BEGIN
  IF p_evento_id IS NULL OR p_evento_id !~ '^[a-zA-Z0-9_-]{8,128}$'
    OR p_id_mensaje IS NULL OR p_id_mensaje !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_tipo NOT IN ('email.sent','email.delivered','email.delivery_delayed',
                     'email.bounced','email.complained','email.failed','email.suppressed')
    OR p_ocurrido_en IS NULL
  THEN RAISE EXCEPTION 'Evento inválido' USING ERRCODE='22023'; END IF;

  INSERT INTO public.notificaciones_resend_webhook_eventos
    (id_evento,id_mensaje_proveedor,tipo,ocurrido_en)
  VALUES (p_evento_id,p_id_mensaje,p_tipo,p_ocurrido_en)
  ON CONFLICT (id_evento) DO NOTHING;
  GET DIAGNOSTICS v_insertado = ROW_COUNT;
  IF v_insertado=0 THEN RETURN 'duplicado'; END IF;
  v_aplicado:=public.talentai_aplicar_evento_webhook_resend(p_evento_id);
  RETURN CASE WHEN v_aplicado THEN 'aplicado' ELSE 'pendiente' END;
END;
$fn$;

-- Si el webhook llega mientras Resend aún está finalizando el envío, queda
-- pendiente y se relaciona automáticamente al registrar el ID del proveedor.
CREATE OR REPLACE FUNCTION public.talentai_reconciliar_webhook_al_aceptar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_evento record;
BEGIN
  IF NEW.estado='aceptado_proveedor' AND NEW.id_mensaje_proveedor IS NOT NULL
    AND (OLD.id_mensaje_proveedor IS DISTINCT FROM NEW.id_mensaje_proveedor
      OR OLD.estado IS DISTINCT FROM NEW.estado) THEN
    FOR v_evento IN
      SELECT e.id_evento FROM public.notificaciones_resend_webhook_eventos e
      WHERE e.id_mensaje_proveedor=NEW.id_mensaje_proveedor AND e.procesado=false
      ORDER BY e.ocurrido_en,e.id_evento
    LOOP
      PERFORM public.talentai_aplicar_evento_webhook_resend(v_evento.id_evento);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_talentai_webhook_resend_aceptacion ON public.notificaciones_email;
CREATE TRIGGER trg_talentai_webhook_resend_aceptacion
AFTER UPDATE OF estado,id_mensaje_proveedor ON public.notificaciones_email
FOR EACH ROW EXECUTE FUNCTION public.talentai_reconciliar_webhook_al_aceptar();

-- Reconciliación administrativa para interrupciones y carreras transaccionales
-- raras; no reenvía ningún correo. Si no hay ID Resend, no afecta la cola.
CREATE OR REPLACE FUNCTION public.talentai_conciliar_webhooks_resend(p_limite integer DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_evento record; v_total integer:=0;
BEGIN
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Límite inválido' USING ERRCODE='22023';
  END IF;
  FOR v_evento IN
    SELECT e.id_evento FROM public.notificaciones_resend_webhook_eventos e
    WHERE e.procesado=false ORDER BY e.ocurrido_en,e.id_evento LIMIT p_limite
  LOOP
    IF public.talentai_aplicar_evento_webhook_resend(v_evento.id_evento) THEN
      v_total:=v_total+1;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$fn$;

-- REVOKE después de crear funciones SECURITY DEFINER: acceso backend solamente.
REVOKE ALL ON FUNCTION public.talentai_registrar_webhook_resend(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_aplicar_evento_webhook_resend(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_conciliar_webhooks_resend(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.talentai_reconciliar_webhook_al_aceptar() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_registrar_webhook_resend(text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_conciliar_webhooks_resend(integer) TO service_role;
-- El helper se invoca por una función SECURITY DEFINER, no mediante REST.
COMMENT ON TABLE public.notificaciones_resend_webhook_eventos IS
  'Eventos HMAC verificados de Resend; guarda solo metadata técnica mínima y evita duplicados por svix-id.';
NOTIFY pgrst,'reload schema';
COMMIT;
