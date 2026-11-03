-- TalentAI Fase 5C: cola segura, control de concurrencia, aprobaciones,
-- simulaciones auditables y conciliación CONSERVADORA de recepciones.
-- DEPENDENCIAS: SQL 10 y 11 aplicados y validados. No envía emails.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.notificaciones_email') IS NULL
     OR to_regclass('public.aplicaciones_ats') IS NULL
     OR to_regprocedure('public.talentai_registrar_notificacion_ats()') IS NULL THEN
    RAISE EXCEPTION 'Faltan dependencias de Fase 5A/5B. No ejecutar la Fase 5C.';
  END IF;
END $$;

ALTER TABLE public.notificaciones_email
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS bloqueado_hasta timestamptz,
  ADD COLUMN IF NOT EXISTS aprobado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobado_en timestamptz;

ALTER TABLE public.notificaciones_email
  DROP CONSTRAINT IF EXISTS notificaciones_email_estado_check;
ALTER TABLE public.notificaciones_email
  ADD CONSTRAINT notificaciones_email_estado_check CHECK (
    estado IN ('pendiente','procesando','aceptado_proveedor','fallido','cancelado','requiere_revision')
  );
CREATE INDEX IF NOT EXISTS idx_notificaciones_email_lease
  ON public.notificaciones_email(bloqueado_hasta)
  WHERE estado = 'procesando';

CREATE TABLE IF NOT EXISTS public.notificaciones_email_intentos (
  id_intento uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_notificacion uuid NOT NULL REFERENCES public.notificaciones_email(id_notificacion) ON DELETE CASCADE,
  resultado varchar(32) NOT NULL CHECK (resultado IN (
    'simulado','fallo_transitorio','fallo_permanente','lease_expirado'
  )),
  numero_intento integer NOT NULL DEFAULT 0 CHECK (numero_intento >= 0),
  codigo_diagnostico varchar(40) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_intentos_notificacion
  ON public.notificaciones_email_intentos(id_notificacion, creado_en DESC);
ALTER TABLE public.notificaciones_email_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notificaciones_email_intentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificaciones_email_intentos TO service_role;

-- Watermark de seguridad: nunca reconstruir masivamente candidaturas antiguas.
-- Si ya hay recepciones 5B, usar el ID mínimo con evidencia real de 5B;
-- de lo contrario solo candidaturas futuras (> max_id actual).
CREATE TABLE IF NOT EXISTS public.notificaciones_configuracion (
  id smallint PRIMARY KEY CHECK (id = 1),
  id_aplicacion_desde integer NOT NULL CHECK (id_aplicacion_desde > 0),
  creado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.notificaciones_configuracion(id, id_aplicacion_desde)
SELECT 1, COALESCE(
  (SELECT MIN(id_aplicacion) FROM public.notificaciones_email
   WHERE tipo_evento = 'postulacion_recibida' AND id_aplicacion IS NOT NULL),
  (SELECT COALESCE(MAX(id_aplicacion),0) + 1 FROM public.aplicaciones_ats)
)
ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.notificaciones_configuracion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notificaciones_configuracion FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificaciones_configuracion TO service_role;

-- Reclamo atómico: SKIP LOCKED evita procesar una fila desde dos workers.
-- Leases vencidos se aíslan en revisión manual (no se reenvían ciegamente).
CREATE OR REPLACE FUNCTION public.talentai_reclamar_notificaciones_mock(p_limite integer DEFAULT 10)
RETURNS TABLE (
  id_notificacion uuid, lease_token uuid, tipo_evento varchar,
  destinatario_email varchar, nombre_candidato varchar, titulo_vacante varchar
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Límite debe estar entre 1 y 20' USING ERRCODE = '22023';
  END IF;

  -- Estado ambiguo: en el futuro podría haberse enviado a un proveedor.
  WITH vencidos AS (
    UPDATE public.notificaciones_email n
       SET estado = 'requiere_revision', lease_token = NULL,
           bloqueado_hasta = NULL, actualizado_en = clock_timestamp(),
           ultimo_error = 'LEASE_EXPIRED'
     WHERE n.estado = 'procesando' AND n.bloqueado_hasta < clock_timestamp()
     RETURNING n.id_notificacion, n.intentos
  )
  INSERT INTO public.notificaciones_email_intentos(
    id_notificacion, resultado, numero_intento, codigo_diagnostico
  )
  SELECT v.id_notificacion, 'lease_expirado', v.intentos, 'LEASE_EXPIRED'
  FROM vencidos v;

  RETURN QUERY
  WITH candidatas AS (
    SELECT n.id_notificacion
    FROM public.notificaciones_email n
    WHERE n.estado IN ('pendiente','fallido')
      AND n.proximo_intento_en <= clock_timestamp()
      AND n.intentos < n.max_intentos
      AND n.datos->>'aprobado_envio' = 'true'
      AND n.datos->>'requiere_aprobacion' IN ('true','false')
    ORDER BY n.proximo_intento_en, n.creado_en
    FOR UPDATE SKIP LOCKED
    LIMIT p_limite
  )
  UPDATE public.notificaciones_email n
  SET estado='procesando', iniciado_en=clock_timestamp(),
      bloqueado_hasta=clock_timestamp()+interval '2 minutes',
      lease_token=gen_random_uuid(), actualizado_en=clock_timestamp()
  FROM candidatas c
  WHERE n.id_notificacion=c.id_notificacion
  RETURNING n.id_notificacion, n.lease_token, n.tipo_evento,
            n.destinatario_email, n.nombre_candidato, n.titulo_vacante;
END;
$fn$;

-- Finalización condicionada por token: evita confirmar claims ajenos.
-- Nunca admite resultado 'aceptado_proveedor' en esta fase.
CREATE OR REPLACE FUNCTION public.talentai_finalizar_notificacion_mock(
  p_id uuid, p_token uuid, p_resultado text, p_codigo text DEFAULT 'MOCK_OK'
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_intentos integer;
  v_max integer;
  v_estado text;
BEGIN
  IF p_resultado NOT IN ('simulado','fallo_transitorio','fallo_permanente') THEN
    RAISE EXCEPTION 'Resultado no autorizado en simulación' USING ERRCODE='22023';
  END IF;
  IF p_codigo NOT IN ('MOCK_OK','TEMPLATE_ERROR','TRANSPORT_UNAVAILABLE','UNKNOWN_ERROR') THEN
    RAISE EXCEPTION 'Diagnóstico no permitido' USING ERRCODE='22023';
  END IF;

  SELECT n.intentos, n.max_intentos INTO v_intentos, v_max
  FROM public.notificaciones_email n
  WHERE n.id_notificacion=p_id AND n.lease_token=p_token AND n.estado='procesando'
    AND n.bloqueado_hasta > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease inexistente o caducado' USING ERRCODE='P0002';
  END IF;

  IF p_resultado='simulado' THEN
    v_estado := 'pendiente';
    UPDATE public.notificaciones_email n SET
      estado='pendiente', proximo_intento_en=clock_timestamp()+interval '15 minutes',
      iniciado_en=NULL, lease_token=NULL, bloqueado_hasta=NULL,
      actualizado_en=clock_timestamp(), ultimo_error=NULL
    WHERE n.id_notificacion=p_id;
  ELSE
    v_intentos := least(v_intentos + 1, v_max);
    v_estado := 'fallido';
    UPDATE public.notificaciones_email n SET
      estado='fallido', intentos=v_intentos,
      proximo_intento_en=clock_timestamp()+
        (least(3600, 60 * power(2::numeric, least(v_intentos-1, 6)))::double precision * interval '1 second'),
      iniciado_en=NULL, lease_token=NULL, bloqueado_hasta=NULL,
      actualizado_en=clock_timestamp(), ultimo_error=p_codigo
    WHERE n.id_notificacion=p_id;
  END IF;

  INSERT INTO public.notificaciones_email_intentos(
    id_notificacion, resultado, numero_intento, codigo_diagnostico
  ) VALUES (p_id, p_resultado, v_intentos, p_codigo);
  RETURN v_estado;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.talentai_aprobar_notificacion(p_id uuid, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.usuarios WHERE id=p_actor AND rol='admin'
  ) THEN RAISE EXCEPTION 'Administrador inválido' USING ERRCODE='42501'; END IF;

  UPDATE public.notificaciones_email n SET
    datos=jsonb_set(n.datos,'{aprobado_envio}','true'::jsonb),
    aprobado_por=p_actor, aprobado_en=clock_timestamp(),
    actualizado_en=clock_timestamp()
  WHERE n.id_notificacion=p_id
    AND n.estado IN ('pendiente','fallido')
    AND n.datos->>'requiere_aprobacion'='true'
    AND n.datos->>'aprobado_envio'='false';
  RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.talentai_cancelar_notificacion(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE public.notificaciones_email n SET
    estado='cancelado', actualizado_en=clock_timestamp(),
    lease_token=NULL, bloqueado_hasta=NULL
  WHERE n.id_notificacion=p_id AND n.estado IN ('pendiente','fallido','requiere_revision');
  RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.talentai_reprogramar_notificacion(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE public.notificaciones_email n SET
    estado='pendiente', proximo_intento_en=clock_timestamp(),
    actualizado_en=clock_timestamp(), ultimo_error=NULL,
    lease_token=NULL, bloqueado_hasta=NULL
  WHERE n.id_notificacion=p_id AND n.estado IN ('fallido','requiere_revision')
    AND n.intentos < n.max_intentos;
  RETURN FOUND;
END;
$fn$;

-- Se recupera SOLO confirmación de recepción, sin fingir transiciones antiguas.
-- Nuevos registros conciliados requieren aprobación manual antes del procesamiento.
CREATE OR REPLACE FUNCTION public.talentai_conciliar_recepciones(p_limite integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_insertados integer;
BEGIN
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Límite de conciliación no permitido' USING ERRCODE='22023';
  END IF;
  WITH faltantes AS (
    SELECT a.id_aplicacion, btrim(c.nombre) nombre,
           lower(btrim(c.correo)) correo, btrim(v.titulo) vacante
    FROM public.aplicaciones_ats a
    JOIN public.candidatos c ON c.id_candidato=a.id_candidato
    JOIN public.vacantes v ON v.id_vacante=a.id_vacante
    WHERE a.id_aplicacion >= (SELECT id_aplicacion_desde FROM public.notificaciones_configuracion WHERE id=1)
      AND btrim(c.nombre) <> '' AND btrim(c.correo) <> '' AND btrim(v.titulo) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.notificaciones_email n
        WHERE n.id_aplicacion=a.id_aplicacion AND n.tipo_evento='postulacion_recibida'
      )
    ORDER BY a.id_aplicacion
    LIMIT p_limite
  ), insertadas AS (
    INSERT INTO public.notificaciones_email(
      id_aplicacion, clave_idempotencia, tipo_evento, destinatario_email,
      nombre_candidato, titulo_vacante, estado, datos
    )
    SELECT f.id_aplicacion, 'ats:postulacion:'||f.id_aplicacion::text,
      'postulacion_recibida', f.correo, f.nombre, f.vacante, 'pendiente',
      jsonb_build_object('origen','conciliacion_5c','requiere_aprobacion',true,'aprobado_envio',false)
    FROM faltantes f
    ON CONFLICT (clave_idempotencia) DO NOTHING
    RETURNING id_notificacion
  )
  SELECT count(*)::integer INTO v_insertados FROM insertadas;
  RETURN v_insertados;
END;
$fn$;

-- RPC solo con service_role; no políticas para clientes directos.
REVOKE ALL ON FUNCTION public.talentai_reclamar_notificaciones_mock(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.talentai_finalizar_notificacion_mock(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.talentai_aprobar_notificacion(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.talentai_cancelar_notificacion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.talentai_reprogramar_notificacion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.talentai_conciliar_recepciones(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.talentai_reclamar_notificaciones_mock(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_finalizar_notificacion_mock(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_aprobar_notificacion(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_cancelar_notificacion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_reprogramar_notificacion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.talentai_conciliar_recepciones(integer) TO service_role;

COMMENT ON TABLE public.notificaciones_email_intentos IS 'Fase 5C: intentos simulados o fallidos, sin datos de correo, secretos ni contenido';
COMMENT ON TABLE public.notificaciones_configuracion IS 'Marca de corte de conciliación: no recuperar postulaciones históricas arbitrariamente';
COMMENT ON FUNCTION public.talentai_reclamar_notificaciones_mock(integer) IS 'Reclama trabajo de manera concurrente usando SKIP LOCKED; simulación exclusiva';
-- Notificar a PostgREST para que descubra las RPC nuevas de inmediato.
NOTIFY pgrst, 'reload schema';
COMMIT;
