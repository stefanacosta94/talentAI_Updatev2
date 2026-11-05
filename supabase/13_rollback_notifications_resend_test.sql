-- Reversión no destructiva: detiene funcionalidad Resend de prueba.
-- NO elimina columnas ni intentos, para conservar evidencia/auditoría.
BEGIN;
DROP FUNCTION IF EXISTS public.talentai_finalizar_notificacion_resend_prueba(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.talentai_reclamar_notificaciones_resend_prueba(integer);
DROP FUNCTION IF EXISTS public.talentai_autorizar_prueba_resend(uuid,uuid);
UPDATE public.notificaciones_email
SET prueba_resend_autorizada=false,
    actualizado_en=clock_timestamp()
WHERE prueba_resend_autorizada=true AND estado IN ('pendiente','fallido');
NOTIFY pgrst,'reload schema';
COMMIT;
-- Devolver EMAIL_MODE=mock y RESEND_TEST_ENABLED=false en .env (manual).
