-- TalentAI Cierre 02 · verificar objetos y permisos (solo lectura).
SELECT
  to_regclass('public.ats_verificaciones_correo') AS tabla_verificaciones,
  to_regprocedure('public.ats_iniciar_verificacion_correo(text,text)') AS rpc_inicio,
  to_regprocedure('public.ats_cancelar_verificacion_correo(text,text)') AS rpc_cancelacion,
  to_regprocedure('public.ats_confirmar_postulacion_verificada(text,text,text,text,text,integer,text)') AS rpc_postulacion,
  to_regprocedure('public.ats_purgar_verificaciones_correo()') AS rpc_purga;

SELECT
  'ats_iniciar_verificacion_correo' AS funcion,
  has_function_privilege('anon', 'public.ats_iniciar_verificacion_correo(text,text)', 'EXECUTE') AS anon_puede_ejecutar,
  has_function_privilege('authenticated', 'public.ats_iniciar_verificacion_correo(text,text)', 'EXECUTE') AS auth_puede_ejecutar,
  has_function_privilege('service_role', 'public.ats_iniciar_verificacion_correo(text,text)', 'EXECUTE') AS service_puede_ejecutar
UNION ALL
SELECT
  'ats_confirmar_postulacion_verificada',
  has_function_privilege('anon', 'public.ats_confirmar_postulacion_verificada(text,text,text,text,text,integer,text)', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.ats_confirmar_postulacion_verificada(text,text,text,text,text,integer,text)', 'EXECUTE'),
  has_function_privilege('service_role', 'public.ats_confirmar_postulacion_verificada(text,text,text,text,text,integer,text)', 'EXECUTE');

-- Verificar que los triggers anteriores siguen presentes y habilitados.
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.aplicaciones_ats'::regclass
   AND tgname IN ('trg_ats_encolar_evaluacion_ia',
                  'trg_talentai_notificacion_postulacion',
                  'trg_talentai_notificacion_estado')
 ORDER BY tgname;

-- Control general: no muestra OTP, hash ni correos.
SELECT COUNT(*) AS verificaciones_activas,
       COUNT(*) FILTER (WHERE codigo_hash IS NOT NULL AND expira_en > now()) AS pendientes_validas,
       COUNT(*) FILTER (WHERE actualizado_en < now() - interval '48 hours') AS elegibles_purga
FROM public.ats_verificaciones_correo;
