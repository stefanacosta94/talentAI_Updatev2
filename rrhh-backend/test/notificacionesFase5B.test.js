'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EVENTOS } = require('../src/services/mailTemplates');

const raiz = path.resolve(__dirname, '../..');
const migracion = fs.readFileSync(path.join(raiz, 'supabase/11_notifications_ats_events.sql'), 'utf8');
const verificacion = fs.readFileSync(path.join(raiz, 'supabase/11_verify_notifications_ats_events.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(raiz, 'supabase/11_rollback_notifications_ats_events.sql'), 'utf8');

test('Fase 5B: registra recepción solamente tras INSERT de una aplicación ATS', () => {
  assert.match(migracion, /AFTER INSERT ON public\.aplicaciones_ats/i);
  assert.match(migracion, /v_evento\s*:=\s*'postulacion_recibida'/);
  assert.match(migracion, /ats:postulacion:/);
});

test('Fase 5B: solo registra transiciones de estado reales', () => {
  assert.match(migracion, /AFTER UPDATE OF estado_proceso ON public\.aplicaciones_ats/i);
  assert.match(migracion, /WHEN\s*\(OLD\.estado_proceso IS DISTINCT FROM NEW\.estado_proceso\)/);
  assert.match(migracion, /IF OLD\.estado_proceso IS NOT DISTINCT FROM NEW\.estado_proceso/i);
});

test('Fase 5B: correspondencia completa con las cinco plantillas', () => {
  const eventos = Object.keys(EVENTOS);
  assert.equal(eventos.length, 5);
  for (const evento of eventos) assert.match(migracion, new RegExp(`'${evento}'`));
  for (const estado of ['En Revisión', 'Entrevista', 'Contratado', 'Descartado']) {
    assert.ok(migracion.includes(`WHEN '${estado}' THEN`));
  }
});

test('Fase 5B: idempotencia de recepción y persistencia de evento pendiente', () => {
  assert.match(migracion, /ats:postulacion:' \|\| NEW\.id_aplicacion::text/);
  assert.match(migracion, /ON CONFLICT \(clave_idempotencia\) DO NOTHING/);
  assert.match(migracion, /'pendiente'/);
});

test('Fase 5B: fallos del registro no abortan postulación/estado y no exponen PII', () => {
  assert.match(migracion, /EXCEPTION WHEN OTHERS THEN/);
  assert.match(migracion, /RAISE WARNING 'TalentAI: no se pudo registrar evento ATS, aplicacion=%, operacion=%, SQLSTATE=%'/);
  assert.match(migracion, /RETURN NEW;/);
  assert.doesNotMatch(migracion, /RAISE WARNING[^\n]*(?:v_correo|v_nombre|v_vacante)/);
});

test('Fase 5B: decisiones terminales exigen aprobación para el futuro despachador', () => {
  assert.match(migracion, /v_aprobacion\s*:=\s*v_evento IN \('contratado', 'descartado'\)/);
  assert.match(migracion, /'requiere_aprobacion', v_aprobacion/);
  assert.match(migracion, /'aprobado_envio', NOT v_aprobacion/);
});

test('Fase 5B: permisos restringidos y sin envío de mensajes ni backfill', () => {
  assert.match(migracion, /SECURITY DEFINER/);
  assert.match(migracion, /SET search_path = pg_catalog/);
  assert.match(migracion, /REVOKE ALL ON FUNCTION public\.talentai_registrar_notificacion_ats\(\) FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migracion, /(?:http_post|smtp|enviarCorreo|pg_cron|net\.http_post)/i);
  assert.doesNotMatch(migracion, /INSERT INTO public\.notificaciones_email\s*SELECT/i);
});

test('Fase 5B: incluye verificación de triggers, RLS e idempotencia y rollback no destructivo', () => {
  assert.match(verificacion, /01_TRIGGERS/);
  assert.match(verificacion, /03_QUEUE_SECURITY/);
  assert.match(verificacion, /05_DUPLICATES/);
  assert.match(rollback, /DROP TRIGGER IF EXISTS trg_talentai_notificacion_postulacion/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.talentai_registrar_notificacion_ats/);
  assert.doesNotMatch(rollback, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('Fase 5B: la interfaz informa correctamente que el envío real sigue desactivado', () => {
  const html = fs.readFileSync(path.join(raiz,'rrhh-frontend/notificaciones.html'), 'utf8');
  assert.match(html, /envío a candidatos reales permanece desactivado/i);
  assert.doesNotMatch(html, /Fase 5C · Procesamiento simulado/);
  const frontend = fs.readFileSync(path.join(raiz,'rrhh-frontend/js/notificaciones.js'), 'utf8');
  assert.match(frontend, /Aún no hay notificaciones/);
});
