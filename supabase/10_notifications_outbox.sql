-- TalentAI - Fase 5A: base para notificaciones transaccionales.
-- Requiere ejecutar previamente el modelo de ATS existente.
-- No crea triggers, no envía emails y no modifica aplicaciones existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.notificaciones_email (
  id_notificacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_aplicacion integer REFERENCES public.aplicaciones_ats(id_aplicacion) ON DELETE CASCADE,
  clave_idempotencia varchar(180) NOT NULL UNIQUE,
  tipo_evento varchar(40) NOT NULL,
  destinatario_email varchar(254) NOT NULL,
  nombre_candidato varchar(120) NOT NULL,
  titulo_vacante varchar(180) NOT NULL,
  estado varchar(24) NOT NULL DEFAULT 'pendiente',
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  intentos integer NOT NULL DEFAULT 0,
  max_intentos integer NOT NULL DEFAULT 5,
  proximo_intento_en timestamptz NOT NULL DEFAULT now(),
  iniciado_en timestamptz,
  enviado_en timestamptz,
  id_mensaje_proveedor text,
  ultimo_error text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificaciones_email_tipo_check CHECK (
    tipo_evento IN ('postulacion_recibida', 'en_revision', 'entrevista', 'contratado', 'descartado')
  ),
  CONSTRAINT notificaciones_email_estado_check CHECK (
    estado IN ('pendiente', 'procesando', 'aceptado_proveedor', 'fallido', 'cancelado')
  ),
  CONSTRAINT notificaciones_email_intentos_check CHECK (
    intentos >= 0 AND max_intentos BETWEEN 1 AND 20 AND intentos <= max_intentos
  ),
  CONSTRAINT notificaciones_email_email_check CHECK (
    length(btrim(destinatario_email)) > 3 AND destinatario_email NOT LIKE '% %'
  ),
  CONSTRAINT notificaciones_email_datos_object_check CHECK (jsonb_typeof(datos) = 'object')
);

-- Las futuras colas usarán este índice para localizar trabajo pendiente.
CREATE INDEX IF NOT EXISTS idx_notificaciones_email_pendientes
  ON public.notificaciones_email (proximo_intento_en, creado_en)
  WHERE estado IN ('pendiente', 'fallido');
CREATE INDEX IF NOT EXISTS idx_notificaciones_email_historial
  ON public.notificaciones_email (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_email_aplicacion
  ON public.notificaciones_email (id_aplicacion) WHERE id_aplicacion IS NOT NULL;

ALTER TABLE public.notificaciones_email ENABLE ROW LEVEL SECURITY;
-- No hay policies para anon/authenticated: solo el backend con service_role.
REVOKE ALL ON TABLE public.notificaciones_email FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificaciones_email TO service_role;

COMMENT ON TABLE public.notificaciones_email IS
 'Cola transaccional de correos TalentAI. Fase 5A crea el esquema, sin despacho ni disparadores.';
COMMENT ON COLUMN public.notificaciones_email.estado IS
 'aceptado_proveedor no confirma entrega en bandeja ni lectura.';
COMMENT ON COLUMN public.notificaciones_email.clave_idempotencia IS
 'Identificador único por evento de negocio, no solamente por estado de candidato.';
COMMENT ON COLUMN public.notificaciones_email.ultimo_error IS
 'Solo diagnóstico técnico saneado: nunca guardar claves ni credenciales.';

COMMIT;
