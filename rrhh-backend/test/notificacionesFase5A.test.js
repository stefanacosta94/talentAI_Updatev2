'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EVENTOS, renderEmail } = require('../src/services/mailTemplates');
const { enviarCorreo } = require('../src/services/emailTransport');

const raizFrontend = path.resolve(__dirname, '../../rrhh-frontend');
const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/10_notifications_outbox.sql'), 'utf8');

test('cinco eventos transaccionales admitidos', () => {
  assert.deepEqual(Object.keys(EVENTOS), ['postulacion_recibida','en_revision','entrevista','contratado','descartado']);
});
test('plantillas producen texto alternativo y HTML legible', () => {
  for (const evento of Object.keys(EVENTOS)) {
    const c = renderEmail({ evento, nombreCandidato: 'Ana', tituloVacante: 'Analista' });
    assert.match(c.html, /Analista/);
    assert.match(c.texto, /Ana/);
    assert.match(c.asunto, /Equipo de selección/);
  }
});
test('entrada no confiable se escapa en HTML', () => {
  const c = renderEmail({ evento: 'entrevista', nombreCandidato: '<script>alert(1)</script>', tituloVacante: '<img onerror=x>' });
  assert.doesNotMatch(c.html, /<script>/);
  assert.doesNotMatch(c.html, /<img onerror/);
  assert.match(c.html, /&lt;script&gt;/);
});
test('evento desconocido se rechaza', () => {
  assert.throws(() => renderEmail({ evento: 'admin', nombreCandidato:'Ana', tituloVacante:'X'}), /Evento/);
});
test('transporte simulado no confirma envío', async () => {
  const c = await enviarCorreo({ para:'test@example.com', asunto:'Test', html:'<p>Hola</p>', texto:'Hola' });
  assert.equal(c.simulado, true);
  assert.equal(c.aceptadoPorProveedor, false);
});
test('modo real no está habilitado en fase 5A', async () => {
  const previo = process.env.EMAIL_MODE;
  process.env.EMAIL_MODE = 'smtp';
  try {
    await assert.rejects(enviarCorreo({ para:'test@example.com', asunto:'Test', html:'<p>Hola</p>', texto:'Hola' }), /únicamente se permite/);
  } finally {
    if (previo === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = previo;
  }
});
test('SQL activa RLS, impide acceso anónimo y tiene idempotencia', () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.notificaciones_email FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /clave_idempotencia varchar\(180\) NOT NULL UNIQUE/);
  assert.doesNotMatch(sql, /CREATE TRIGGER/i);
});
test('rutas de notificaciones protegidas', () => {
  const rutas = fs.readFileSync(path.resolve(__dirname,'../src/routes/notificaciones.routes.js'), 'utf8');
  assert.match(rutas, /router\.use\(verificarToken, adminOnly\)/);
  assert.doesNotMatch(rutas, /router\.post\(/);
});
test('pantalla administrativa existe y está enlazada', () => {
  assert.ok(fs.existsSync(path.join(raizFrontend, 'notificaciones.html')));
  const html = fs.readFileSync(path.join(raizFrontend, 'notificaciones.html'), 'utf8');
  assert.match(html, /js\/notificaciones\.js/);
  assert.match(html, /notificaciones-email-body/);
});
