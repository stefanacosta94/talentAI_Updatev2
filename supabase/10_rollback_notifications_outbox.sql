-- USAR SOLO SI SE DECIDE REVERTIR FASE 5A.
-- DESTRUYE PERMANENTEMENTE TODO EL HISTORIAL de notificaciones_email.
-- No ejecutar durante validaciones normales.
BEGIN;
DROP TABLE IF EXISTS public.notificaciones_email;
COMMIT;
