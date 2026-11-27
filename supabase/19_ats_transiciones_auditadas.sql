-- TalentAI cierre: actualización de estado y bitácora en UNA transacción.
-- Prerrequisitos: aplicaciones_ats; bitacora_auditoria; usuarios; estados homologados de Fase 3C.
-- Política acordada en esta iteración: terminales Contratado / Descartado;
-- regreso Entrevista -> En Revisión permitido por reevaluación.
BEGIN;
CREATE OR REPLACE FUNCTION public.ats_cambiar_estado_auditado(
  p_id_aplicacion integer,
  p_estado text,
  p_id_usuario uuid
) RETURNS TABLE(resultado text, estado_anterior text, estado_nuevo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_estado_actual text;
  v_permitido boolean := false;
BEGIN
  IF p_id_aplicacion IS NULL OR p_id_aplicacion <= 0 OR p_id_usuario IS NULL THEN
    RETURN QUERY SELECT 'solicitud_invalida'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT a.estado_proceso INTO v_estado_actual
    FROM public.aplicaciones_ats a
    WHERE a.id_aplicacion = p_id_aplicacion
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_encontrada'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF p_estado = v_estado_actual THEN
    RETURN QUERY SELECT 'sin_cambios'::text, v_estado_actual, v_estado_actual;
    RETURN;
  END IF;

  v_permitido := coalesce(CASE v_estado_actual
    WHEN 'Recibida' THEN p_estado IN ('En Revisión', 'Descartado')
    WHEN 'En Revisión' THEN p_estado IN ('Entrevista', 'Descartado')
    WHEN 'Entrevista' THEN p_estado IN ('En Revisión', 'Contratado', 'Descartado')
    ELSE false
  END, false);
  IF NOT v_permitido THEN
    RETURN QUERY SELECT 'transicion_invalida'::text, v_estado_actual, p_estado;
    RETURN;
  END IF;

  UPDATE public.aplicaciones_ats
    SET estado_proceso = p_estado
    WHERE id_aplicacion = p_id_aplicacion;

  -- Si la inserción en bitácora falla, PostgreSQL revierte el cambio de estado.
  INSERT INTO public.bitacora_auditoria (id_usuario, accion, modulo, detalle)
  VALUES (
    p_id_usuario,
    'Cambio estado ATS',
    'Aplicaciones ATS',
    format('Aplicación %s: %s -> %s', p_id_aplicacion, v_estado_actual, p_estado)
  );
  RETURN QUERY SELECT 'actualizada'::text, v_estado_actual, p_estado;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ats_cambiar_estado_auditado(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ats_cambiar_estado_auditado(integer, text, uuid) TO service_role;
COMMIT;
