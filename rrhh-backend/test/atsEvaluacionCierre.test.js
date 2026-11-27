'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function cargarArchivo(rel, mocks, env = {}) {
  const filename = path.join(__dirname, '..', rel);
  const module = { exports: {} };
  const loader = name => {
    if (name === 'node:crypto') return { randomUUID: () => 'uuid-test' };
    if (!(name in mocks)) throw new Error(`Import inesperado: ${name}`);
    return mocks[name];
  };
  const fn = vm.runInNewContext(`(function (require, module, exports, process, Buffer) { ${fs.readFileSync(filename, 'utf8')}\n})`,
    { console, setTimeout, setInterval, clearTimeout, clearInterval });
  fn(loader, module, module.exports, { env }, Buffer);
  return module.exports;
}

const servicioBase = {
  'pdf-extraction': async () => ({ text: 'CV válido' }),
  '../config/gemini': { generateContent: async () => ({ response: { text: () => '{}' } }) },
};

test('ATS-IA: valida rangos, esquema y cero como puntaje legítimo', () => {
  const { extraerJsonIA } = cargarArchivo('src/services/atsService.js', servicioBase);
  const valid = JSON.stringify({ ai_match_score: 0, ai_resumen_habilidades: '  Sin coincidencias  ', habilidades_encontradas: [], habilidades_faltantes: ['Experiencia'] });
  const parsed = extraerJsonIA('```json\n' + valid + '\n```');
  assert.equal(parsed.ai_match_score, 0);
  assert.equal(parsed.ai_resumen_habilidades, 'Sin coincidencias');
  for (const item of [
    { ai_match_score: 150, ai_resumen_habilidades: 'resumen', habilidades_encontradas: [], habilidades_faltantes: [] },
    { ai_match_score: '80', ai_resumen_habilidades: 'resumen', habilidades_encontradas: [], habilidades_faltantes: [] },
    { ai_match_score: 80, ai_resumen_habilidades: 'resumen', habilidades_encontradas: 'texto', habilidades_faltantes: [] },
    { ai_match_score: 80, ai_resumen_habilidades: '', habilidades_encontradas: [], habilidades_faltantes: [] },
  ]) assert.throws(() => extraerJsonIA(JSON.stringify(item)), /IA_RESPUESTA_INVALIDA/);
  assert.throws(() => extraerJsonIA('esto no es JSON'), /IA_RESPUESTA_INVALIDA/);
});

function simuladorPublico({ resultado = 'creada', falloIdentidad = false } = {}) {
  const events = [];
  const routes = {};
  const router = {
    get() {}, use() {},
    post(url, ...handlers) { routes[url] = handlers.at(-1); },
  };
  const db = {
    from(tabla) {
      events.push(`consultar:${tabla}`);
      if (tabla !== 'vacantes') throw new Error('No se deben consultar candidatos sin verificación.');
      return { select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { id_vacante: 3, estado: 'Activa' }, error: null }; },
      };
    },
  };
  const mocks = {
    express: { Router: () => router },
    multer: Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) }),
    'express-rate-limit': () => () => {},
    '../config/supabase': db,
    '../services/candidateIdentityService': {
      configVerificacion() { return {}; },
      async iniciarVerificacion() { events.push('solicitar:codigo'); },
      async confirmarPostulacion() {
        events.push('confirmar:sql');
        if (falloIdentidad) throw new Error('Servicio inactivo');
        return { resultado, id_aplicacion: 57 };
      },
    },
    '../services/storageService': {
      uploadPrivatePdf: async () => { events.push('storage:upload'); return 'cv_abcdefab-abcd-4abc-8abc-abcdabcdabcd_candidato.pdf'; },
      removeStoredObject: async () => { events.push('storage:delete'); },
    },
    '../utils/supabaseRetry': { withSupabaseRetry: op => op(), createSupabaseError: e => e },
    '../security/securityUtils': require('../src/security/securityUtils'),
  };
  cargarArchivo('src/routes/public.routes.js', mocks);
  async function invocar(url, req) {
    const response = { statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; } };
    let error;
    await routes[url](req, response, e => { error = e; });
    if (error) throw error;
    return response;
  }
  const postular = (codigo = '123456') => invocar('/aplicar', {
    body: { id_vacante: '3', nombre: 'Candidato', correo: 'TEST@example.com', codigo_verificacion: codigo },
    file: { mimetype: 'application/pdf', buffer: Buffer.from('%PDF-12345') },
  });
  const solicitar = () => invocar('/verificacion/iniciar', { body: { correo: 'test@example.com' } });
  return { events, postular, solicitar };
}

test('ATS-PUBLIC: al iniciar verificación no revela si existe el candidato', async () => {
  const sim = simuladorPublico();
  const res = await sim.solicitar();
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.verificacion_requerida, true);
  assert.ok(!sim.events.some(e => e.includes('candidatos')));
});

test('ATS-PUBLIC: una candidatura solo se registra tras confirmar OTP en SQL', async () => {
  const sim = simuladorPublico();
  const res = await sim.postular();
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.correo_verificado, true);
  assert.equal(res.body.evaluacion_ia, 'pendiente');
  assert.ok(sim.events.indexOf('storage:upload') < sim.events.indexOf('confirmar:sql'));
  assert.ok(!sim.events.includes('storage:delete'));
});

test('ATS-PUBLIC: OTP inválido no provoca subida del CV', async () => {
  const sim = simuladorPublico();
  const res = await sim.postular('hola');
  assert.equal(res.statusCode, 400);
  assert.ok(!sim.events.includes('storage:upload'));
});

test('ATS-PUBLIC: OTP incorrecto elimina el CV y no crea una candidatura', async () => {
  const sim = simuladorPublico({ resultado: 'codigo_invalido' });
  const res = await sim.postular();
  assert.equal(res.statusCode, 400);
  assert.ok(sim.events.includes('storage:delete'));
});

test('ATS-PUBLIC: evita segunda candidatura para la misma vacante tras verificación', async () => {
  const sim = simuladorPublico({ resultado: 'ya_postulado' });
  const res = await sim.postular();
  assert.equal(res.statusCode, 409);
  assert.ok(sim.events.includes('storage:delete'));
});

test('ATS-PUBLIC: un error de Supabase limpia CV temporal sin invocar Gemini', async () => {
  const sim = simuladorPublico({ falloIdentidad: true });
  await assert.rejects(sim.postular(), /Servicio inactivo/);
  assert.ok(sim.events.includes('storage:delete'));
  assert.ok(!sim.events.includes('gemini'));
});

function simuladorWorker({ falloIA = false, puntajeExistente = null } = {}) {
  const calls = [];
  const db = {
    rpc(fn, params) {
      calls.push([fn, params]);
      if (fn === 'ats_tomar_evaluacion') return Promise.resolve({ data: [{ id_aplicacion: 57, lease_token: 'uuid-test', intentos: 1 }], error: null });
      if (fn === 'ats_finalizar_evaluacion') return Promise.resolve({ data: true, error: null });
      throw new Error('RPC desconocida');
    },
    from(tabla) {
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          if (tabla === 'aplicaciones_ats') return { data: { id_aplicacion: 57, id_vacante: 3, ai_match_score: puntajeExistente, url_archivo_cv: 'ruta.pdf' }, error: null };
          if (tabla === 'vacantes') return { data: { titulo: 'Vacante', descripcion_puesto: 'Descripción', requisitos: 'Node' }, error: null };
          throw new Error('Tabla no esperada');
        },
      };
    },
    storage: { from() { return { async download() { return { data: { arrayBuffer: async () => Buffer.from('%PDF-12345') }, error: null }; } }; } },
  };
  const fakeService = {
    extraerTextoPDF: async () => 'CV correcto',
    evaluarCandidato: async () => {
      if (falloIA) throw Object.assign(new Error('IA_SERVICIO_NO_DISPONIBLE'), { status: 429 });
      return { ai_match_score: 82, ai_resumen_habilidades: 'Candidato apto', habilidades_encontradas: ['Node'], habilidades_faltantes: [] };
    },
    validarEvaluacionIA: valor => valor,
  };
  const worker = cargarArchivo('src/services/atsEvaluationWorker.js', {
    '../config/supabase': db,
    './atsService': fakeService,
    './storageService': { normalizeStoragePath: p => p },
  });
  return { calls, worker };
}

test('ATS-WORKER: completa trabajo con el mismo token de reserva', async () => {
  const { calls, worker } = simuladorWorker();
  const resp = await worker.procesarUnaEvaluacion();
  assert.equal(resp.resultado, 'completada');
  assert.equal(calls[1][1].p_lease_token, 'uuid-test');
  assert.equal(calls[1][1].p_puntaje, 82);
});

test('ATS-WORKER: una caída de IA cierra intento con error controlado', async () => {
  const { calls, worker } = simuladorWorker({ falloIA: true });
  const resp = await worker.procesarUnaEvaluacion();
  assert.equal(resp.resultado, 'IA_CUOTA');
  assert.equal(calls[1][1].p_error_codigo, 'IA_CUOTA');
  assert.equal(calls[1][1].p_puntaje, null);
});

test('ATS-SQL: migración define la cola, reserva SKIP LOCKED y actualización atómica', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/18_ats_async_evaluations.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ats_evaluaciones_ia/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /CREATE TRIGGER trg_ats_encolar_evaluacion_ia/);
  assert.match(sql, /UPDATE public\.aplicaciones_ats/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.ats_tomar_evaluacion/);
});
