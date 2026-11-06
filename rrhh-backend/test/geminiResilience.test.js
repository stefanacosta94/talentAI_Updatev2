'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helper = require('../src/services/geminiRetry');

const mkError = (status, message = '') => Object.assign(new Error(message || String(status)), { status });

function fakeModel(results, counts) {
  let i = 0;
  return {
    async generateContent() {
      counts.calls += 1;
      const item = results[Math.min(i++, results.length - 1)];
      if (item instanceof Error) throw item;
      return { response: { text: () => item } };
    },
  };
}

function loadRagService({ primary, fallback = [], env = {} }) {
  const file = path.join(__dirname, '..', 'src', 'services', 'ragService.js');
  const warnings = [];
  const counts = { primary: { calls: 0 }, fallback: { calls: 0 } };
  const primaryModel = fakeModel(primary, counts.primary);
  const fallbackModel = fakeModel(fallback, counts.fallback);
  const module = { exports: {} };
  const config = { GEMINI_API_KEY: 'fake-not-a-key', GEMINI_MODEL: 'gemini-3.6-flash', ...env };
  const fakeRequire = name => {
    if (name === '../config/gemini') return primaryModel;
    if (name === '@google/generative-ai') return { GoogleGenerativeAI: class {
      getGenerativeModel() { return fallbackModel; }
    } };
    if (name === './geminiRetry') return {
      ...helper,
      withGeminiRetry: (fn, opts) => helper.withGeminiRetry(fn, { ...opts, wait: async () => {} }),
    };
    throw new Error(`Import inesperado: ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, require: fakeRequire,
    process: { env: config },
    console: { warn: (...args) => warnings.push(args) },
  }, { filename: file });
  return { service: module.exports, counts, warnings };
}

test('Gemini: HTTP 503 se reintenta y puede recuperarse', async () => {
  let count = 0;
  const delays = [];
  const result = await helper.withGeminiRetry(async () => {
    count += 1;
    if (count < 3) throw mkError(503, 'high demand');
    return 'respuesta correcta';
  }, { maxAttempts: 3, wait: async ms => delays.push(ms) });
  assert.equal(result, 'respuesta correcta');
  assert.equal(count, 3);
  assert.equal(delays.length, 2);
});

test('Gemini: API key incorrecta no se reintenta', async () => {
  let count = 0;
  await assert.rejects(helper.withGeminiRetry(async () => {
    count += 1;
    throw mkError(401, 'Invalid API key');
  }, { wait: async () => {} }), { status: 401 });
  assert.equal(count, 1);
});

test('Gemini: cuotas diarias agotadas no generan reintentos', async () => {
  assert.equal(helper.isTransient(mkError(429, 'daily quota exceeded')), false);
  assert.equal(helper.isTransient(mkError(429, 'too many requests short burst')), true);
});

test('RAG: un 503 temporal se recupera sin informar error', async () => {
  const { service, counts } = loadRagService({ primary: [mkError(503), 'Respuesta con base documental'] });
  const result = await service.consultarReglamento('Días libres', 'Documento de prueba');
  assert.equal(result, 'Respuesta con base documental');
  assert.equal(counts.primary.calls, 2);
});

test('RAG: 503 persistente produce error HTTP 503 seguro y sin texto documental', async () => {
  const { service, counts, warnings } = loadRagService({ primary: [mkError(503, 'high demand')] });
  await assert.rejects(
    service.consultarReglamento('Secreto del solicitante', 'Documento confidencial para no registrar'),
    error => error.code === 'GEMINI_UNAVAILABLE' && error.status === 503 && error.retryable === true,
  );
  assert.equal(counts.primary.calls, 3);
  const printed = JSON.stringify(warnings);
  assert.doesNotMatch(printed, /Secreto del solicitante|Documento confidencial/);
});

test('RAG: fallback opcional se usa después de saturación primaria', async () => {
  const { service, counts } = loadRagService({
    primary: [mkError(503)], fallback: ['Respuesta desde respaldo'],
    env: { GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite' },
  });
  assert.equal(await service.consultarReglamento('Pregunta', 'Contexto'), 'Respuesta desde respaldo');
  assert.equal(counts.primary.calls, 3);
  assert.equal(counts.fallback.calls, 1);
});

test('RAG: credenciales erróneas no activan fallback', async () => {
  const { service, counts } = loadRagService({
    primary: [mkError(403, 'forbidden')], fallback: ['No se debe usar'],
    env: { GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite' },
  });
  await assert.rejects(service.consultarReglamento('Pregunta', 'Contexto'), error =>
    error.status === 502 && error.code === 'GEMINI_SERVICE_ERROR');
  assert.equal(counts.primary.calls, 1);
  assert.equal(counts.fallback.calls, 0);
});

test('RAG: ruta conserva autorización 6A y responde indisponibilidad sin excepción global', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/rag.routes.js'), 'utf8');
  // Se comprueba la misma ruta y manejo de errores aunque prettier reformatee el JS.
  assert.match(source, /router\s*\.\s*post\s*\(\s*(['"])\/chat\1\s*,\s*verificarToken\s*,\s*chatOnly\s*,\s*async\b/);
  assert.match(source, /if\s*\(\s*error\?\.isGeminiServiceError\s*\)/);
  assert.match(source, /res\s*\.\s*status\s*\(\s*error\.status\s*\)\s*\.\s*json\s*\(/);
  assert.match(source, /reintentar\s*:\s*error\.retryable/);
});

test('RAG: interfaz conserva pregunta ante 503 y evita doble envío simultáneo', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../rrhh-frontend/js/chat-empleado.js'), 'utf8');
  assert.match(source, /inputPregunta\.value = pregunta/);
  assert.match(source, /const indisponible = error\.status === 503/);
  assert.match(source, /if \(!pregunta \|\| consultaEnCurso\) return/);
});
