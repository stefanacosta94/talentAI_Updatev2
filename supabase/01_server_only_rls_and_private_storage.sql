/*
SECURITY HARDENING - FASE 2
Arquitectura: Browser -> Express/JWT -> Supabase service_role

REQUISITO PREVIO:
El backend DEBE estar funcionando con SUPABASE_SERVICE_ROLE_KEY.
No ejecutar primero sobre el código antiguo basado en SUPABASE_ANON_KEY.
*/

BEGIN;

-- 1) Toda tabla de negocio queda protegida por RLS.
-- No se crean policies para anon/authenticated porque ningún navegador
-- debe acceder a Supabase directamente; Express es la frontera de autorización.
ALTER TABLE IF EXISTS public.aplicaciones_ats ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.base_conocimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bitacora_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.candidatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.logs_interaccion_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.solicitudes_rrhh ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vacantes ENABLE ROW LEVEL SECURITY;

-- 2) Eliminar las policies extremadamente permisivas de Storage.
DROP POLICY IF EXISTS "Acceso total al bucket curriculums" ON storage.objects;
DROP POLICY IF EXISTS "Acceso total al bucket documentos" ON storage.objects;

-- 3) Hacer privados los buckets y aplicar defensa en profundidad para PDFs.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id IN ('curriculums', 'documentos_empresa');

COMMIT;
