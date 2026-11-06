-- Verificacion reversible del hotfix Fase 8A.
-- Ejecutar en Supabase SQL Editor DESPUES del hotfix.
-- El ROLLBACK impide que el test conserve reclamaciones o reservas.
-- Recomendado mantener RESEND_AUTO_ENABLED=false durante esta prueba.
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) AS reservas_temporales
FROM public.talentai_reclamar_notificaciones_resend_auto(5);
ROLLBACK;

-- Control de que no existe permiso de uso para roles publicos.
SELECT
  has_function_privilege('anon', 'public.talentai_reclamar_notificaciones_resend_auto(integer)', 'EXECUTE') AS anon_puede_ejecutar,
  has_function_privilege('authenticated', 'public.talentai_reclamar_notificaciones_resend_auto(integer)', 'EXECUTE') AS autenticado_puede_ejecutar,
  has_function_privilege('service_role', 'public.talentai_reclamar_notificaciones_resend_auto(integer)', 'EXECUTE') AS servicio_puede_ejecutar;
