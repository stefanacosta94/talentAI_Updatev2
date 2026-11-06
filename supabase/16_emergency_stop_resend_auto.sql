-- Fase 8A — DETENCION DE EMERGENCIA SOLO SI SE REQUIERE.
-- Revoca las autorizaciones automaticas aun si hay varios workers en marcha.
-- No detiene solicitudes HTTP YA INICIADAS. NO EJECUTAR en instalacion normal.
BEGIN;
UPDATE public.notificaciones_email
SET auto_resend_autorizado=false, actualizado_en=clock_timestamp()
WHERE auto_resend_autorizado=true AND estado IN ('pendiente','fallido');
COMMIT;
