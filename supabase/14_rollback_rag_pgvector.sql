-- SOLO PARA REVERSION DELIBERADA. BORRA LOS EMBEDDINGS Y LAS TABLAS NUEVAS.
-- Preserva public.base_conocimiento y los PDFs.
BEGIN;
DROP TRIGGER IF EXISTS tr_rag_invalidar_documento ON public.base_conocimiento;
DROP FUNCTION IF EXISTS public.rag_invalidar_por_cambio_documento();
DROP FUNCTION IF EXISTS public.rag_buscar_fragmentos(public.vector,text,integer,real);
DROP FUNCTION IF EXISTS public.rag_activar_indice(integer,uuid,text,text,integer);
DROP TABLE IF EXISTS public.base_conocimiento_fragmentos;
DROP TABLE IF EXISTS public.base_conocimiento_indices;
COMMIT;
