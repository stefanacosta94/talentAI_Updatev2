-- ================================================================
-- TalentAI · Fase 5B · Alta automática de eventos de notificación ATS
-- Requiere: 10_notifications_outbox.sql (Fase 5A)
-- Esta migración NO envía correos ni procesa la cola.
-- No genera notificaciones retroactivas para postulaciones anteriores.
-- ================================================================
BEGIN;

-- Validación de dependencias ANTES de instalar triggers.
DO $$
BEGIN
  IF to_regclass('public.notificaciones_email') IS NULL
    OR to_regclass('public.aplicaciones_ats') IS NULL
    OR to_regclass('public.candidatos') IS NULL
    OR to_regclass('public.vacantes') IS NULL THEN
    RAISE EXCEPTION 'Falta alguna tabla requerida. Ejecuta primero Fase 5A y verifica el esquema ATS.';
  END IF;
END $$;

-- Un único punto de integración para ambas rutas de postulación
-- y para cualquier actualización del ATS ejecutada por Express.
CREATE OR REPLACE FUNCTION public.talentai_registrar_notificacion_ats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_evento text;
  v_clave text;
  v_nombre text;
  v_correo text;
  v_vacante text;
  v_aprobacion boolean;
  v_datos jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Una sola recepción por aplicación, incluso si se reintentara el registro.
    v_evento := 'postulacion_recibida';
    v_clave := 'ats:postulacion:' || NEW.id_aplicacion::text;
    v_datos := jsonb_build_object(
      'origen', 'creacion_aplicacion',
      'estado_nuevo', NEW.estado_proceso,
      'requiere_aprobacion', false,
      'aprobado_envio', true
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Una actualización al mismo estado no constituye un nuevo evento.
    IF OLD.estado_proceso IS NOT DISTINCT FROM NEW.estado_proceso THEN
      RETURN NEW;
    END IF;

    v_evento := CASE NEW.estado_proceso
      WHEN 'En Revisión' THEN 'en_revision'
      WHEN 'Entrevista' THEN 'entrevista'
      WHEN 'Contratado' THEN 'contratado'
      WHEN 'Descartado' THEN 'descartado'
      ELSE NULL
    END;
    -- Volver a «Recibida» no vuelve a enviar confirmación de postulación.
    IF v_evento IS NULL THEN
      RETURN NEW;
    END IF;

    -- Cada transición EFECTIVA tiene identidad independiente. Un nuevo
    -- cambio a la misma etapa, tras pasar por otra, sí es otro evento.
    v_clave := 'ats:transicion:' || NEW.id_aplicacion::text || ':' || gen_random_uuid()::text;
    v_aprobacion := v_evento IN ('contratado', 'descartado');
    v_datos := jsonb_build_object(
      'origen', 'cambio_estado',
      'estado_anterior', OLD.estado_proceso,
      'estado_nuevo', NEW.estado_proceso,
      'requiere_aprobacion', v_aprobacion,
      'aprobado_envio', NOT v_aprobacion
    );
  ELSE
    RETURN NEW;
  END IF;

  -- Punto de aislamiento de fallos: una incidencia en la cola no debe
  -- invalidar una postulación o una transición ya válida.
  BEGIN
    SELECT btrim(c.nombre), lower(btrim(c.correo)), btrim(v.titulo)
      INTO v_nombre, v_correo, v_vacante
    FROM public.candidatos AS c
    JOIN public.vacantes AS v ON v.id_vacante = NEW.id_vacante
    WHERE c.id_candidato = NEW.id_candidato;

    IF v_nombre IS NULL OR v_nombre = ''
       OR v_correo IS NULL OR v_correo = ''
       OR v_vacante IS NULL OR v_vacante = '' THEN
      RAISE EXCEPTION 'Faltan datos mínimos del candidato o la vacante';
    END IF;

    INSERT INTO public.notificaciones_email (
      id_aplicacion,
      clave_idempotencia,
      tipo_evento,
      destinatario_email,
      nombre_candidato,
      titulo_vacante,
      estado,
      datos
    ) VALUES (
      NEW.id_aplicacion,
      v_clave,
      v_evento,
      v_correo,
      v_nombre,
      v_vacante,
      'pendiente',
      v_datos
    )
    ON CONFLICT (clave_idempotencia) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    -- No registrar correo, nombre ni información confidencial en el log.
    -- Advertencia en logs de PostgreSQL: revisar y reconciliar en Fase 5C.
    RAISE WARNING 'TalentAI: no se pudo registrar evento ATS, aplicacion=%, operacion=%, SQLSTATE=%',
      NEW.id_aplicacion, TG_OP, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

-- La función no debe ser invocable directamente por clientes de Supabase.
REVOKE ALL ON FUNCTION public.talentai_registrar_notificacion_ats() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_talentai_notificacion_postulacion ON public.aplicaciones_ats;
CREATE TRIGGER trg_talentai_notificacion_postulacion
AFTER INSERT ON public.aplicaciones_ats
FOR EACH ROW
EXECUTE FUNCTION public.talentai_registrar_notificacion_ats();

DROP TRIGGER IF EXISTS trg_talentai_notificacion_estado ON public.aplicaciones_ats;
CREATE TRIGGER trg_talentai_notificacion_estado
AFTER UPDATE OF estado_proceso ON public.aplicaciones_ats
FOR EACH ROW
WHEN (OLD.estado_proceso IS DISTINCT FROM NEW.estado_proceso)
EXECUTE FUNCTION public.talentai_registrar_notificacion_ats();

COMMENT ON FUNCTION public.talentai_registrar_notificacion_ats() IS
 'Fase 5B: registra eventos de postulación y transiciones efectivas en la cola, sin enviar mensajes.';
COMMENT ON TABLE public.notificaciones_email IS
 'Cola de emails TalentAI: eventos automáticos ATS desde Fase 5B. El despacho está deshabilitado hasta Fase 5C/5D.';

COMMIT;
