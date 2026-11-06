-- TalentAI Fase 7B — Cola duradera para indexación vectorial.
-- Requisito: migración 14_rag_pgvector.sql ya aplicada.
-- Idempotente. Conserva documentos, fragmentos y versiones activas anteriores.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.base_conocimiento_indices') IS NULL
     OR to_regclass('public.base_conocimiento_fragmentos') IS NULL THEN
    RAISE EXCEPTION 'Aplica primero la migración SQL 14 del RAG vectorial';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.rag_tareas_indexacion (
  id_documento integer PRIMARY KEY REFERENCES public.base_conocimiento(id_documento) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','procesando','parcial','completado','error','pausado')),
  fragmentos_total integer NOT NULL DEFAULT 0 CHECK (fragmentos_total BETWEEN 0 AND 5000),
  fragmentos_guardados integer NOT NULL DEFAULT 0 CHECK (fragmentos_guardados BETWEEN 0 AND 5000),
  errores_consecutivos integer NOT NULL DEFAULT 0 CHECK (errores_consecutivos BETWEEN 0 AND 100),
  proxima_ejecucion timestamptz,
  lease_token uuid,
  lease_hasta timestamptz,
  ultimo_error_codigo text CHECK (ultimo_error_codigo IS NULL OR ultimo_error_codigo ~ '^[A-Z0-9_]{1,40}$'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rag_lease_pareja CHECK ((lease_token IS NULL) = (lease_hasta IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_rag_tareas_elegibles
ON public.rag_tareas_indexacion(proxima_ejecucion,actualizado_en)
WHERE estado IN ('pendiente','parcial','error','procesando');

ALTER TABLE public.rag_tareas_indexacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rag_tareas_indexacion FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rag_tareas_indexacion TO service_role;

-- Encolar solo si se inserta un documento o cambia REALMENTE su contenido.
-- El trigger de fase 7A invalida índices antiguos al cambiar contenido_texto.
CREATE OR REPLACE FUNCTION public.rag_encolar_documento()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.contenido_texto IS NOT DISTINCT FROM OLD.contenido_texto THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.rag_tareas_indexacion
    (id_documento,estado,fragmentos_total,fragmentos_guardados,
     errores_consecutivos,proxima_ejecucion,lease_token,lease_hasta,ultimo_error_codigo)
  VALUES (NEW.id_documento,'pendiente',0,0,0,now(),NULL,NULL,NULL)
  ON CONFLICT (id_documento) DO UPDATE
    SET estado='pendiente',fragmentos_total=0,fragmentos_guardados=0,
        errores_consecutivos=0,proxima_ejecucion=now(),lease_token=NULL,
        lease_hasta=NULL,ultimo_error_codigo=NULL,actualizado_en=now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_rag_encolar_insert ON public.base_conocimiento;
CREATE TRIGGER tr_rag_encolar_insert AFTER INSERT ON public.base_conocimiento
FOR EACH ROW EXECUTE FUNCTION public.rag_encolar_documento();
DROP TRIGGER IF EXISTS tr_rag_encolar_update ON public.base_conocimiento;
CREATE TRIGGER tr_rag_encolar_update AFTER UPDATE OF contenido_texto ON public.base_conocimiento
FOR EACH ROW EXECUTE FUNCTION public.rag_encolar_documento();
REVOKE ALL ON FUNCTION public.rag_encolar_documento() FROM PUBLIC,anon,authenticated;

-- Registrar los documentos existentes sin recomputar embeddings ya activos.
-- Se respeta todo registro de cola existente en una nueva ejecución del SQL.
INSERT INTO public.rag_tareas_indexacion
  (id_documento,estado,fragmentos_total,fragmentos_guardados,proxima_ejecucion)
SELECT d.id_documento,
       CASE WHEN i.id_documento IS NOT NULL THEN 'completado' ELSE 'pendiente' END,
       COALESCE(i.total_fragmentos,0),COALESCE(i.total_fragmentos,0),
       CASE WHEN i.id_documento IS NULL THEN now() ELSE NULL END
FROM public.base_conocimiento d
LEFT JOIN public.base_conocimiento_indices i ON i.id_documento=d.id_documento
ON CONFLICT (id_documento) DO NOTHING;

-- Toma atómica con SKIP LOCKED y lease recuperable después de interrupciones.
-- El reloj de la BD decide la elegibilidad; no depende de los relojes del backend.
CREATE OR REPLACE FUNCTION public.rag_tomar_tarea()
RETURNS TABLE(id_documento integer, lease_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id integer; v_token uuid;
BEGIN
  SELECT t.id_documento INTO v_id FROM public.rag_tareas_indexacion t
  WHERE ((t.estado IN ('pendiente','parcial','error')
           AND (t.proxima_ejecucion IS NULL OR t.proxima_ejecucion<=now()))
        OR (t.estado='procesando' AND t.lease_hasta<now()))
  ORDER BY t.actualizado_en ASC,t.id_documento ASC
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE public.rag_tareas_indexacion t
     SET estado='procesando',lease_token=v_token,lease_hasta=now()+interval '15 minutes',
         proxima_ejecucion=NULL,actualizado_en=now()
  WHERE t.id_documento=v_id;
  id_documento := v_id;
  lease_token := v_token;
  RETURN NEXT;
END;
$$;

-- Solo el dueño del lease puede guardar progreso o finalizar un lote.
-- Una modificación del PDF revoca el lease y el lote viejo ya no puede publicarse.
CREATE OR REPLACE FUNCTION public.rag_finalizar_lote(
 p_id_documento integer,p_lease_token uuid,p_estado text,
 p_total integer,p_guardados integer,p_error_codigo text DEFAULT NULL,
 p_espera_segundos integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_updated integer;
BEGIN
 IF p_estado NOT IN ('parcial','completado','error','pausado')
    OR p_total<0 OR p_total>5000 OR p_guardados<0 OR p_guardados>p_total
    OR p_espera_segundos<0 OR p_espera_segundos>86400
    OR (p_error_codigo IS NOT NULL AND p_error_codigo !~ '^[A-Z0-9_]{1,40}$') THEN
   RAISE EXCEPTION 'Parámetros inválidos de lote RAG';
 END IF;
 IF p_estado='completado' AND NOT EXISTS (
   SELECT 1 FROM public.base_conocimiento_indices WHERE id_documento=p_id_documento
 ) THEN
   RAISE EXCEPTION 'No se puede marcar completo un índice inactivo';
 END IF;
 UPDATE public.rag_tareas_indexacion t SET
    estado=p_estado,fragmentos_total=p_total,fragmentos_guardados=p_guardados,
    errores_consecutivos=CASE WHEN p_estado IN ('error','pausado')
      THEN LEAST(100,t.errores_consecutivos+1) ELSE 0 END,
    proxima_ejecucion=CASE WHEN p_estado IN ('completado','pausado') THEN NULL
      ELSE now()+make_interval(secs=>p_espera_segundos) END,
    lease_token=NULL,lease_hasta=NULL,
    ultimo_error_codigo=p_error_codigo,actualizado_en=now()
 WHERE t.id_documento=p_id_documento AND t.estado='procesando'
   AND t.lease_token=p_lease_token AND t.lease_hasta>now();
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 RETURN v_updated=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.rag_reintentar_tarea(p_id_documento integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_updated integer;
BEGIN
 UPDATE public.rag_tareas_indexacion
 SET estado='pendiente',proxima_ejecucion=now(),lease_token=NULL,lease_hasta=NULL,
     errores_consecutivos=0,ultimo_error_codigo=NULL,actualizado_en=now()
 WHERE id_documento=p_id_documento AND estado IN ('pausado','error','parcial');
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 RETURN v_updated=1;
END;
$$;

REVOKE ALL ON FUNCTION public.rag_tomar_tarea() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rag_finalizar_lote(integer,uuid,text,integer,integer,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rag_reintentar_tarea(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rag_tomar_tarea() TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_finalizar_lote(integer,uuid,text,integer,integer,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_reintentar_tarea(integer) TO service_role;
COMMIT;
