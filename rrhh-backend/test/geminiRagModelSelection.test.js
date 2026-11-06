'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const retry = require('../src/services/geminiRetry');

const modulePath = path.join(__dirname, '../src/services/ragService.js');
const source = fs.readFileSync(modulePath, 'utf8');

function fail(status, message) { return Object.assign(new Error(message), { status }); }

function mockResponse(text, usageMetadata) {
  return { response: { text: () => text, usageMetadata } };
}

function fixture({ env = {}, outputs = {} } = {}) {
  const counts = { shared: 0 };
  const initialized = [];
  const logs = [];
  const shared = { async generateContent() {
    counts.shared += 1;
    const sequence = outputs.shared || [mockResponse('Respuesta ATS compartida')];
    const action = sequence[Math.min(counts.shared - 1, sequence.length - 1)];
    if (action instanceof Error) throw action;
    return action;
  } };
  const modelHandles = new Map();
  const fakeRequire = (name) => {
    if (name === '../config/gemini') return shared;
    if (name === '@google/generative-ai') return { GoogleGenerativeAI: class {
      constructor(key) { assert.equal(key, 'clave-ficticia-no-real'); }
      getGenerativeModel({ model }) {
        initialized.push(model);
        if (!modelHandles.has(model)) modelHandles.set(model, { async generateContent() {
          counts[model] = (counts[model] || 0) + 1;
          const sequence = outputs[model] || [mockResponse(`Respuesta de ${model}`)];
          const action = sequence[Math.min(counts[model] - 1, sequence.length - 1)];
          if (action instanceof Error) throw action;
          return action;
        } });
        return modelHandles.get(model);
      }
    } };
    if (name === './geminiRetry') return {
      ...retry,
      withGeminiRetry: (fn, options) => retry.withGeminiRetry(fn, { ...options, wait: async () => {} }),
    };
    throw new Error(`Dependencia inesperada: ${name}`);
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: fakeRequire,
    console: {
      warn: (...args) => logs.push(['warn', ...args]),
      info: (...args) => logs.push(['info', ...args]),
    },
    process: { env: {
      GEMINI_API_KEY: 'clave-ficticia-no-real',
      GEMINI_MODEL: 'gemini-3.6-flash',
      GEMINI_RETRY_ATTEMPTS: '2',
      ...env,
    } },
  }, { filename: modulePath });
  return { service: module.exports, initialized, counts, logs };
}

test('6A.2: RAG usa GEMINI_RAG_MODEL independiente, sin consumir modelo compartido del ATS', async () => {
  const f = fixture({ env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite' } });
  assert.equal(f.service.ragModelName(), 'gemini-3.5-flash-lite');
  assert.equal(await f.service.consultarReglamento('Pregunta', 'Documento'), 'Respuesta de gemini-3.5-flash-lite');
  assert.equal(f.counts.shared, 0);
  assert.equal(f.counts['gemini-3.5-flash-lite'], 1);
  assert.deepEqual(f.initialized, ['gemini-3.5-flash-lite']);
});

test('6A.2: sin GEMINI_RAG_MODEL conserva modelo compartido anterior', async () => {
  const f = fixture();
  assert.equal(f.service.ragModelName(), 'gemini-3.6-flash');
  assert.equal(await f.service.consultarReglamento('Pregunta', 'Documento'), 'Respuesta ATS compartida');
  assert.equal(f.counts.shared, 1);
  assert.equal(f.initialized.length, 0);
});

test('6A.2: configuración vacía de modelo RAG mantiene compatibilidad', async () => {
  const f = fixture({ env: { GEMINI_RAG_MODEL: '   ' } });
  await f.service.consultarReglamento('Pregunta', 'Documento');
  assert.equal(f.counts.shared, 1);
});

test('6A.2: telemetría recoge consumo y latencia sin PII ni texto documental', async () => {
  const f = fixture({
    env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite' },
    outputs: { 'gemini-3.5-flash-lite': [mockResponse('Contenido de respuesta CONFIDENCIAL', {
      promptTokenCount: 123, candidatesTokenCount: 18, totalTokenCount: 141,
    })] },
  });
  const answer = await f.service.consultarReglamento('PREGUNTA-PRIVADA', 'DOCUMENTO-PRIVADO');
  assert.match(answer, /CONFIDENCIAL/);
  const info = f.logs.find(entry => entry[0] === 'info');
  assert.equal(info[1], '[RAG] Gemini completado');
  assert.equal(info[2].modelo, 'gemini-3.5-flash-lite');
  assert.equal(info[2].tokensEntrada, 123);
  assert.equal(info[2].tokensSalida, 18);
  assert.equal(info[2].tokensTotales, 141);
  assert.equal(info[2].solicitudesAlModelo, 1);
  assert.equal(info[2].respaldo, false);
  assert.ok(info[2].latenciaMs >= 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /PREGUNTA-PRIVADA|DOCUMENTO-PRIVADO|CONFIDENCIAL|clave-ficticia/);
});

test('6A.2: metadatos de tokens ausentes o inválidos se registran como null', () => {
  const f = fixture();
  const stats = f.service.geminiUsage(mockResponse('ok', { promptTokenCount: -4, candidatesTokenCount: '10', totalTokenCount: 42 }));
  assert.equal(stats.tokensEntrada, null);
  assert.equal(stats.tokensSalida, null);
  assert.equal(stats.tokensTotales, 42);
  const empty = f.service.geminiUsage(mockResponse('ok', undefined));
  assert.equal(empty.tokensEntrada, null);
  assert.equal(empty.tokensTotales, null);
});

test('6A.2: modelo RAG dedicado reutiliza instancia en varias preguntas', async () => {
  const f = fixture({ env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite' } });
  await f.service.consultarReglamento('Pregunta 1', 'Documento');
  await f.service.consultarReglamento('Pregunta 2', 'Documento');
  assert.deepEqual(f.initialized, ['gemini-3.5-flash-lite']);
  assert.equal(f.counts['gemini-3.5-flash-lite'], 2);
});

test('6A.2: modelo de respaldo se compara con modelo RAG, nunca consigo mismo', async () => {
  const f = fixture({
    env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite', GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite' },
    outputs: { 'gemini-3.5-flash-lite': [fail(503, 'Overload')] },
  });
  await assert.rejects(f.service.consultarReglamento('Pregunta', 'Documento'), err => err.code === 'GEMINI_UNAVAILABLE');
  assert.deepEqual(f.initialized, ['gemini-3.5-flash-lite']);
  assert.equal(f.counts['gemini-3.5-flash-lite'], 2);
});

test('6A.2: si RAG falla temporalmente, fallback usa el modelo indicado y audita consumo', async () => {
  const f = fixture({
    env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite', GEMINI_FALLBACK_MODEL: 'gemini-3.1-flash-lite' },
    outputs: {
      'gemini-3.5-flash-lite': [fail(503, 'Overload')],
      'gemini-3.1-flash-lite': [mockResponse('Respuesta respaldo', { promptTokenCount: 30, candidatesTokenCount: 5, totalTokenCount: 35 })],
    },
  });
  assert.equal(await f.service.consultarReglamento('Pregunta', 'Documento'), 'Respuesta respaldo');
  assert.equal(f.counts['gemini-3.5-flash-lite'], 2);
  assert.equal(f.counts['gemini-3.1-flash-lite'], 1);
  const info = f.logs.find(entry => entry[0] === 'info');
  assert.equal(info[2].modelo, 'gemini-3.1-flash-lite');
  assert.equal(info[2].solicitudesAlModelo, 3);
  assert.equal(info[2].respaldo, true);
});

test('6A.2: cuotas diarias de RAG no fuerzan fallback o reintentos', async () => {
  const f = fixture({
    env: { GEMINI_RAG_MODEL: 'gemini-3.5-flash-lite', GEMINI_FALLBACK_MODEL: 'gemini-3.1-flash-lite' },
    outputs: { 'gemini-3.5-flash-lite': [fail(429, 'daily quota exceeded')] },
  });
  await assert.rejects(f.service.consultarReglamento('Pregunta-PRIVADA', 'Documento-PRIVADO'), err => err.code === 'GEMINI_QUOTA' && err.status === 503);
  assert.equal(f.counts['gemini-3.5-flash-lite'], 1);
  assert.equal(f.counts['gemini-3.1-flash-lite'] || 0, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /Pregunta-PRIVADA|Documento-PRIVADO/);
});

test('6A.2: servicio ATS continúa importando el modelo compartido, y no hay SQL', () => {
  const ats = fs.readFileSync(path.join(__dirname, '../src/services/atsService.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '../src/config/gemini.js'), 'utf8');
  assert.match(ats, /require\(["']\.\.\/config\/gemini["']\)/);
  assert.match(config, /process\.env\.GEMINI_MODEL/);
  assert.doesNotMatch(config, /GEMINI_RAG_MODEL/);
});
