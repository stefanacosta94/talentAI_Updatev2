/*
  TalentAI - Fase 4B.1, ROLLBACK EXPLÍCITO.
  NO ejecutar durante la instalación normal.

  ATENCIÓN: eliminar la columna descarta vínculos que se hayan creado.
  Solo usar si se necesita revertir la fase y se ha verificado/respaldado
  cualquier dato en empleados.id_usuario.
*/

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.empleados
  DROP CONSTRAINT IF EXISTS empleados_id_usuario_fkey;

ALTER TABLE public.empleados
  DROP CONSTRAINT IF EXISTS empleados_id_usuario_unique;

ALTER TABLE public.empleados
  DROP COLUMN IF EXISTS id_usuario;

-- Los comentarios semánticos se pueden conservar; no afectan al runtime.
COMMIT;
NOTIFY pgrst, 'reload schema';
