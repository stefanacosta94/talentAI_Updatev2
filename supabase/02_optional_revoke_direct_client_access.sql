/*
DEFENSA EN PROFUNDIDAD - EJECUTAR SOLO DESPUÉS DE VALIDAR FASE 2.

La aplicación actual no usa Supabase directamente desde el frontend.
RLS ya bloquea el acceso por filas; este script elimina además privilegios
DML directos de anon/authenticated sobre el schema public.

service_role y postgres no son afectados.
*/
BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

COMMIT;
