-- TALENTAI FASE 7A: RAG con pgvector. Se ejecuta DESPUES de 14_preflight_pgvector.sql.
-- NO modifica ni borra base_conocimiento ni su vector_embedding existente.
-- Este proyecto tiene instalada la extensión 'vector' en el esquema 'public'.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='public') THEN
    RAISE EXCEPTION 'No está instalada la extensión vector en public; revisar 14_preflight_pgvector.sql';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.base_conocimiento_indices (
  id_documento integer PRIMARY KEY REFERENCES public.base_conocimiento(id_documento) ON DELETE CASCADE,
  id_version uuid NOT NULL,
  modelo_embedding text NOT NULL CHECK (length(modelo_embedding) BETWEEN 5 AND 90),
  hash_contenido text NOT NULL CHECK (hash_contenido ~ '^[0-9a-f]{32}$'),
  total_fragmentos integer NOT NULL CHECK (total_fragmentos BETWEEN 1 AND 5000),
  indexado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.base_conocimiento_fragmentos (
  id_fragmento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_documento integer NOT NULL REFERENCES public.base_conocimiento(id_documento) ON DELETE CASCADE,
  id_version uuid NOT NULL,
  indice_fragmento integer NOT NULL CHECK (indice_fragmento BETWEEN 0 AND 4999),
  contenido_fragmento text NOT NULL CHECK (length(contenido_fragmento) BETWEEN 1 AND 2200),
  modelo_embedding text NOT NULL CHECK (length(modelo_embedding) BETWEEN 5 AND 90),
  embedding public.vector(1536) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id_documento,id_version,indice_fragmento)
);
CREATE INDEX IF NOT EXISTS idx_rag_fragmentos_doc_version
  ON public.base_conocimiento_fragmentos(id_documento,id_version);
-- Para corpus pequeño se usa búsqueda exacta. HNSW puede añadirse cuando el volumen lo justifique.

ALTER TABLE public.base_conocimiento_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_conocimiento_fragmentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.base_conocimiento_indices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.base_conocimiento_fragmentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_conocimiento_indices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_conocimiento_fragmentos TO service_role;
-- GENERATED ALWAYS AS IDENTITY: la secuencia requiere USAGE para INSERT del cliente.
GRANT USAGE, SELECT ON SEQUENCE public.base_conocimiento_fragmentos_id_fragmento_seq TO service_role;

-- Invalida el índice si cambia el texto, evitando recuperar fragmentos obsoletos.
CREATE OR REPLACE FUNCTION public.rag_invalidar_por_cambio_documento()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF NEW.contenido_texto IS DISTINCT FROM OLD.contenido_texto THEN
    DELETE FROM public.base_conocimiento_indices WHERE id_documento=NEW.id_documento;
    DELETE FROM public.base_conocimiento_fragmentos WHERE id_documento=NEW.id_documento;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_rag_invalidar_documento ON public.base_conocimiento;
CREATE TRIGGER tr_rag_invalidar_documento AFTER UPDATE OF contenido_texto
ON public.base_conocimiento FOR EACH ROW EXECUTE FUNCTION public.rag_invalidar_por_cambio_documento();
REVOKE ALL ON FUNCTION public.rag_invalidar_por_cambio_documento() FROM PUBLIC,anon,authenticated;

-- Publicar una versión SOLO si todos los fragmentos están persistidos y el PDF no cambió.
CREATE OR REPLACE FUNCTION public.rag_activar_indice(
 p_id_documento integer, p_id_version uuid, p_modelo text, p_hash_contenido text, p_total_fragmentos integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_texto text; v_total integer; v_min integer; v_max integer; v_bad integer;
BEGIN
 IF p_total_fragmentos IS NULL OR p_total_fragmentos < 1 OR p_total_fragmentos > 5000 THEN
   RAISE EXCEPTION 'Cantidad de fragmentos inválida';
 END IF;
 SELECT contenido_texto INTO v_texto FROM public.base_conocimiento WHERE id_documento=p_id_documento FOR UPDATE;
 IF NOT FOUND OR md5(v_texto) IS DISTINCT FROM p_hash_contenido THEN
   RAISE EXCEPTION 'Contenido original cambió durante la indexación';
 END IF;
 SELECT count(*),min(indice_fragmento),max(indice_fragmento),
   count(*) FILTER (WHERE modelo_embedding IS DISTINCT FROM p_modelo)
 INTO v_total,v_min,v_max,v_bad
 FROM public.base_conocimiento_fragmentos WHERE id_documento=p_id_documento AND id_version=p_id_version;
 IF v_total<>p_total_fragmentos OR v_min<>0 OR v_max<>p_total_fragmentos-1 OR v_bad<>0 THEN
   RAISE EXCEPTION 'Indexación incompleta, no se activará';
 END IF;
 INSERT INTO public.base_conocimiento_indices (id_documento,id_version,modelo_embedding,hash_contenido,total_fragmentos,indexado_en)
 VALUES(p_id_documento,p_id_version,p_modelo,p_hash_contenido,p_total_fragmentos,now())
 ON CONFLICT (id_documento) DO UPDATE SET id_version=EXCLUDED.id_version,
   modelo_embedding=EXCLUDED.modelo_embedding, hash_contenido=EXCLUDED.hash_contenido,
   total_fragmentos=EXCLUDED.total_fragmentos,indexado_en=now();
 DELETE FROM public.base_conocimiento_fragmentos WHERE id_documento=p_id_documento AND id_version<>p_id_version;
 RETURN true;
END;
$$;

-- Búsqueda por distancia coseno. Retorna únicamente documentos que conservan la misma versión del contenido.
CREATE OR REPLACE FUNCTION public.rag_buscar_fragmentos(
 p_embedding public.vector, p_modelo text, p_top_k integer DEFAULT 5, p_umbral real DEFAULT 0.35)
RETURNS TABLE(id_documento integer,titulo text,indice_fragmento integer,contenido_fragmento text,similitud double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
 SELECT d.id_documento, d.titulo::text, f.indice_fragmento, f.contenido_fragmento,
   (1 - (f.embedding OPERATOR(public.<=>) p_embedding))::double precision AS similitud
 FROM public.base_conocimiento_fragmentos f
 JOIN public.base_conocimiento_indices i
   ON i.id_documento=f.id_documento AND i.id_version=f.id_version AND i.modelo_embedding=f.modelo_embedding
 JOIN public.base_conocimiento d ON d.id_documento=f.id_documento
 WHERE i.modelo_embedding=p_modelo
   AND (1 - (f.embedding OPERATOR(public.<=>) p_embedding)) >= greatest(0,least(coalesce(p_umbral,0.35),0.99))
 ORDER BY f.embedding OPERATOR(public.<=>) p_embedding ASC, d.id_documento ASC, f.indice_fragmento ASC
 LIMIT least(greatest(coalesce(p_top_k,5),1),8);
$$;

REVOKE ALL ON FUNCTION public.rag_activar_indice(integer,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rag_buscar_fragmentos(public.vector,text,integer,real) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rag_activar_indice(integer,uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_buscar_fragmentos(public.vector,text,integer,real) TO service_role;
COMMIT;
