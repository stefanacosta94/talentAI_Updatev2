/*
=========================================================
FASE 3C - INTEGRIDAD DEL ATS Y ELIMINACIÓN DE DUPLICADO

PRECONDICIÓN MANUAL:
Eliminar primero de Storage > curriculums el objeto duplicado:
1781474535847-eduardo-sanders-acosta.pdf

Se conserva la aplicación 5 y se elimina la aplicación 6.
=========================================================
*/

BEGIN;

-- 1. Eliminamos únicamente la aplicación duplicada ya identificada.
DELETE FROM public.aplicaciones_ats
WHERE id_aplicacion = 6
  AND id_candidato = 1
  AND id_vacante = 2;

-- 2. Homologamos estados históricos con el workflow actual.
UPDATE public.aplicaciones_ats
SET estado_proceso = 'Recibida'
WHERE estado_proceso IN ('Nueva', 'Evaluación IA Completada');

-- 3. Homologamos el default para nuevas aplicaciones.
ALTER TABLE public.aplicaciones_ats
  ALTER COLUMN estado_proceso SET DEFAULT 'Recibida';

-- 4. Restringimos el dominio de estados ATS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'aplicaciones_ats_estado_proceso_check'
      AND conrelid = 'public.aplicaciones_ats'::regclass
  ) THEN
    ALTER TABLE public.aplicaciones_ats
      ADD CONSTRAINT aplicaciones_ats_estado_proceso_check
      CHECK (estado_proceso IN (
        'Recibida',
        'En Revisión',
        'Entrevista',
        'Contratado',
        'Descartado'
      ));
  END IF;
END $$;

-- 5. La BD se convierte en la última barrera frente a aplicaciones duplicadas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'aplicaciones_ats_candidato_vacante_unique'
      AND conrelid = 'public.aplicaciones_ats'::regclass
  ) THEN
    ALTER TABLE public.aplicaciones_ats
      ADD CONSTRAINT aplicaciones_ats_candidato_vacante_unique
      UNIQUE (id_candidato, id_vacante);
  END IF;
END $$;

-- 6. Normalizamos referencias antiguas a CV para almacenar solo la ruta privada.
UPDATE public.aplicaciones_ats
SET url_archivo_cv = regexp_replace(
  url_archivo_cv,
  '^https?://[^/]+/storage/v1/object/public/curriculums/',
  ''
)
WHERE url_archivo_cv ~ '^https?://[^/]+/storage/v1/object/public/curriculums/';

COMMIT;
