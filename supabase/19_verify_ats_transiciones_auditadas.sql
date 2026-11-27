-- Solo lectura: valida existencia de RPC y permisos. NO invoca un cambio de estado real.
SELECT p.proname, pg_get_function_arguments(p.oid) argumentos,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as puede_ejecutar_service_role,
  has_function_privilege('anon', p.oid, 'EXECUTE') as puede_ejecutar_anon
FROM pg_proc p WHERE p.proname = 'ats_cambiar_estado_auditado'
  AND p.pronamespace = 'public'::regnamespace;
