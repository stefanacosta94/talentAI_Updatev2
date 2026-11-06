-- TalentAI 8A: diagnóstico reversible de la RPC de reclamo.
-- Ejecutar en Supabase SQL Editor. NO envía correos; ROLLBACK revierte
-- cualquier reserva temporal, incluso si otro admin autorizó mensajes.
-- Si hay error, guardar SQLSTATE y mensaje (omitir datos sensibles al compartir).
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) AS filas_reclamadas_temporales
FROM public.talentai_reclamar_notificaciones_resend_auto(5);
ROLLBACK;
