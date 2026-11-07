-- PARADA DE EMERGENCIA: solo desactiva la política de EVENTOS FUTUROS.
-- No se requiere que el worker de Express esté encendido; parar Express
-- además corta nuevos reclamos. Para desarmar pendientes, usar el botón admin
-- del Centro de Notificaciones, que invoca la RPC auditada.
BEGIN;
UPDATE public.notificaciones_auto_ats_politica SET habilitado=false,
  actualizado_en=clock_timestamp() WHERE id=1;
COMMIT;
-- IMPORTANTE: una solicitud HTTPS ya iniciada no se puede retirar.
