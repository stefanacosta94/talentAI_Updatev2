-- Reversión de Cierre 03, ejecutar solo si también se revierte backend/frontend a Cierre 02.
BEGIN;
DROP FUNCTION IF EXISTS public.ats_listar_aplicaciones_paginadas(integer, integer, text, text, integer);
DROP FUNCTION IF EXISTS public.ats_estadisticas_panel();
DROP INDEX IF EXISTS public.idx_ats_match_orden;
DROP INDEX IF EXISTS public.idx_ats_estado_match_orden;
DROP INDEX IF EXISTS public.idx_ats_vacante_match_orden;
COMMIT;
