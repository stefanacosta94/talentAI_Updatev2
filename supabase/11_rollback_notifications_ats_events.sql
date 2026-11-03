-- Fase 5B · Reversión SOLO de los triggers y la función de generación.
-- No elimina ninguna notificación preexistente.
-- NO ejecutar durante la instalación ni en pruebas normales.
BEGIN;
DROP TRIGGER IF EXISTS trg_talentai_notificacion_postulacion ON public.aplicaciones_ats;
DROP TRIGGER IF EXISTS trg_talentai_notificacion_estado ON public.aplicaciones_ats;
DROP FUNCTION IF EXISTS public.talentai_registrar_notificacion_ats();
COMMENT ON TABLE public.notificaciones_email IS
 'Cola de notificaciones TalentAI (Fase 5A). Sin triggers automáticos ATS.';
COMMIT;
