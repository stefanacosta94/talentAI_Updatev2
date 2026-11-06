-- SOLO REVERSIÓN DELIBERADA DE FASE 7B.
-- Detener Express y poner RAG_AUTO_INDEX_ENABLED=false ANTES de ejecutar.
-- Elimina el historial de progreso de la cola, NO borra PDF, fragmentos ni índices activos de 7A.
BEGIN;
DROP TRIGGER IF EXISTS tr_rag_encolar_insert ON public.base_conocimiento;
DROP TRIGGER IF EXISTS tr_rag_encolar_update ON public.base_conocimiento;
DROP FUNCTION IF EXISTS public.rag_encolar_documento();
DROP FUNCTION IF EXISTS public.rag_tomar_tarea();
DROP FUNCTION IF EXISTS public.rag_finalizar_lote(integer,uuid,text,integer,integer,text,integer);
DROP FUNCTION IF EXISTS public.rag_reintentar_tarea(integer);
DROP TABLE IF EXISTS public.rag_tareas_indexacion;
COMMIT;
