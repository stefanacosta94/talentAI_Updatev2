-- ROLLBACK NO DESTRUCTIVO Fase 5C (solo si se revierte también backend/frontend).
-- NO borra registros, historial de intentos, columnas ni permisos previos.
-- No ejecutar durante la instalación ni las verificaciones.
BEGIN;
DROP FUNCTION IF EXISTS public.talentai_conciliar_recepciones(integer);
DROP FUNCTION IF EXISTS public.talentai_reprogramar_notificacion(uuid);
DROP FUNCTION IF EXISTS public.talentai_cancelar_notificacion(uuid);
DROP FUNCTION IF EXISTS public.talentai_aprobar_notificacion(uuid,uuid);
DROP FUNCTION IF EXISTS public.talentai_finalizar_notificacion_mock(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.talentai_reclamar_notificaciones_mock(integer);
COMMIT;
-- Las columnas/tablas se mantienen para no destruir datos.
-- La migración 12 puede aplicarse de nuevo si fuera necesario.
