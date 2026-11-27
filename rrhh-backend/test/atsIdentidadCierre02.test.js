'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const secret = 'clave-de-pruebas-para-talentai-2026-mas-de-32-bytes';
const env = {
  RESEND_API_KEY: 're_1234567890', RESEND_ACCOUNT_EMAIL: 'owner@example.com',
  ATS_VERIFICATION_SECRET: secret, ATS_VERIFICATION_TEST_MODE: 'true',
};

function cargarServicio({ respuestaHTTP = 200, permitido = true, falloRPC = false } = {}) {
  const llamadas = [];
  const supabase = {
    async rpc(nombre, args) {
      llamadas.push({ nombre, args });
      if (falloRPC) return { data: null, error: { code: '42501' } };
      if (nombre === 'ats_iniciar_verificacion_correo') return { data: permitido, error: null };
      if (nombre === 'ats_confirmar_postulacion_verificada') return { data: [{ resultado: 'creada', id_aplicacion: 99 }], error: null };
      return { data: null, error: null };
    },
  };
  const responses = [];
  async function fetchImpl(url, params) {
    responses.push({ url, params });
    return { ok: respuestaHTTP >= 200 && respuestaHTTP < 300, status: respuestaHTTP };
  }
  const module = { exports: {} };
  const source = readFileSync(path.resolve(root, 'src/services/candidateIdentityService.js'), 'utf8');
  const factory = vm.runInNewContext(`(function(require,module,exports,process) { ${source}\n})`, {
    console, AbortSignal, URL,
  });
  factory(name => {
    if (name === 'node:crypto') return crypto;
    if (name === '../config/supabase') return supabase;
    if (name === '../security/securityUtils') return require('../src/security/securityUtils');
    throw new Error('Import no esperado: ' + name);
  }, module, module.exports, { env });
  return { service: module.exports, llamadas, responses, fetchImpl };
}

test('ATS-ID: OTP tiene 6 dígitos y su HMAC depende del correo y del secreto', () => {
  const { service } = cargarServicio();
  const codigo = service.generarCodigo(() => 42);
  assert.equal(codigo, '000042');
  const a = service.codigoHash('owner@example.com', codigo, secret);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, service.codigoHash('OWNER@example.com', codigo, secret));
  assert.notEqual(a, service.codigoHash('otra@example.com', codigo, secret));
  assert.notEqual(a, codigo);
  assert.throws(() => service.codigoHash('owner@example.com', '111', secret));
});

test('ATS-ID: modo pruebas prohíbe enviar OTP a direcciones ajenas a la cuenta Resend', async () => {
  const { service, llamadas, fetchImpl } = cargarServicio();
  await assert.rejects(service.iniciarVerificacion('ajeno@example.com', { env, fetchImpl }), { status: 503 });
  assert.equal(llamadas.length, 0);
});

test('ATS-ID: iniciar reserva hash y envía código solo al propietario autorizado', async () => {
  const { service, llamadas, responses, fetchImpl } = cargarServicio();
  const r = await service.iniciarVerificacion('OWNER@example.com', { env, fetchImpl });
  assert.equal(r.solicitada, true);
  assert.equal(r.envio, 'aceptado');
  assert.equal(llamadas[0].nombre, 'ats_iniciar_verificacion_correo');
  assert.match(llamadas[0].args.p_codigo_hash, /^[a-f0-9]{64}$/);
  const payload = JSON.parse(responses[0].params.body);
  assert.equal(payload.to[0], 'owner@example.com');
  assert.match(payload.text, /\d{6}/);
  assert.doesNotMatch(JSON.stringify(llamadas), /Tu código/);
  assert.match(responses[0].params.headers['Idempotency-Key'], /^talentai-verificacion-/);
});

test('ATS-ID: cooldown no dispara correo ni revela existencia del candidato', async () => {
  const { service, llamadas, responses, fetchImpl } = cargarServicio({ permitido: false });
  const r = await service.iniciarVerificacion('owner@example.com', { env, fetchImpl });
  assert.equal(r.solicitada, true);
  assert.equal(responses.length, 0);
  assert.equal(llamadas.length, 1);
});

test('ATS-ID: rechazo explícito de Resend invalida código en Supabase', async () => {
  const { service, llamadas, fetchImpl } = cargarServicio({ respuestaHTTP: 403 });
  await assert.rejects(service.iniciarVerificacion('owner@example.com', { env, fetchImpl }), { status: 503 });
  assert.equal(llamadas[1].nombre, 'ats_cancelar_verificacion_correo');
  assert.equal(llamadas[1].args.p_codigo_hash, llamadas[0].args.p_codigo_hash);
});

test('ATS-ID: confirmar usa exclusivamente RPC SQL atómica y hash, no OTP plano', async () => {
  const { service, llamadas } = cargarServicio();
  const r = await service.confirmarPostulacion({
    correo: 'OWNER@example.com', codigo: '123456', nombre: 'Nombre',
    telefono: '', linkedin: '', idVacante: 3, cvPath: 'cv_11111111-2222-4333-8aaa-aaaaaaaaaaaa_nombre.pdf',
  }, { env });
  assert.equal(r.id_aplicacion, 99);
  assert.equal(llamadas[0].nombre, 'ats_confirmar_postulacion_verificada');
  assert.notEqual(llamadas[0].args.p_codigo_hash, '123456');
});

test('ATS-ID: producción exige remitente propio, nunca onboarding de pruebas', () => {
  const { service } = cargarServicio();
  assert.throws(() => service.configVerificacion({ ...env,
    ATS_VERIFICATION_TEST_MODE: 'false', ATS_VERIFICATION_FROM: 'TalentAI <onboarding@resend.dev>',
  }), { status: 503 });
  const config = service.configVerificacion({ ...env, ATS_VERIFICATION_TEST_MODE: 'false',
    ATS_VERIFICATION_FROM: 'TalentAI <reclutamiento@empresa.hn>' });
  assert.equal(config.modoPrueba, false);
});

test('ATS-ID SQL: funciones protegidas, bloqueo, límites, consumo único y triggers de aplicación', () => {
  const sql = readFileSync(path.resolve(root, '../supabase/20_ats_verificacion_correo.sql'), 'utf8');
  for (const marca of [
    /CREATE TABLE IF NOT EXISTS public\.ats_verificaciones_correo/,
    /FOR UPDATE/,
    /interval '10 minutes'/,
    /interval '90 seconds'/,
    /solicitudes_24h >= 5/,
    /intentos >= 5/,
    /UPDATE public\.ats_verificaciones_correo[\s\S]*consumido_en = v_ahora/,
    /REVOKE ALL ON FUNCTION public\.ats_confirmar_postulacion_verificada/,
    /GRANT EXECUTE ON FUNCTION public\.ats_confirmar_postulacion_verificada/,
    /INSERT INTO public\.aplicaciones_ats/,
  ]) assert.match(sql, marca);
});

test('ATS-ID UI: código y flujo bifásico visibles para el postulante', () => {
  const html = readFileSync(path.resolve(root, '../rrhh-frontend/careers.html'), 'utf8');
  const js = readFileSync(path.resolve(root, '../rrhh-frontend/js/careers.js'), 'utf8');
  assert.match(html, /id="c-codigo-verificacion"/);
  assert.match(html, /id="btn-solicitar-codigo"/);
  assert.match(js, /public\/verificacion\/iniciar/);
  assert.match(js, /datos\.append\("codigo_verificacion", codigoInput\.value\.trim\(\)\)/);
});
