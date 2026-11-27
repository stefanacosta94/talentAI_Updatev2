'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizarFiltros, obtenerPaginaAts, obtenerEstadisticasAts } = require('../src/services/atsReadService');
const base = path.resolve(__dirname, '../..');

function mockDb(responses = {}) {
  const calls = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(responses[fn] || { data: null, error: { message: 'missing stub' } });
    },
  };
}

test('ATS-PAG: filtros por defecto seguros y límites 20/50', () => {
  assert.deepEqual(normalizarFiltros(), {
    p_pagina: 1, p_limite: 20, p_busqueda: null, p_estado: null, p_id_vacante: null,
  });
  const f = normalizarFiltros({ pagina: '2', limite: '50', estado: 'Entrevista', id_vacante: '8', busqueda: '   Ana    López  ' });
  assert.deepEqual(f, { p_pagina: 2, p_limite: 50, p_busqueda: 'Ana López', p_estado: 'Entrevista', p_id_vacante: 8 });
});

test('ATS-PAG: rechaza paginación fuera de rango o formatos ambiguos', () => {
  for (const filtro of [
    { pagina: '0' }, { pagina: '-1' }, { pagina: '2.2' }, { pagina: '1e5' }, { pagina: '100001' },
    { limite: '0' }, { limite: '51' }, { limite: '20x' }, { id_vacante: '-4' },
    { busqueda: 'A'.repeat(101) }, { estado: 'Administrador' },
  ]) {
    assert.throws(() => normalizarFiltros(filtro), error => error.status === 400, JSON.stringify(filtro));
  }
});

test('ATS-PAG: permite buscar por texto sin introducirlo en una consulta SQL dinámica', async () => {
  const db = mockDb({ ats_listar_aplicaciones_paginadas: { data: { total: 93, aplicaciones: [{ id_aplicacion: 91, ai_match_score: 0 }] }, error: null } });
  const result = await obtenerPaginaAts(db, { pagina: '3', limite: '10', busqueda: `ana'; DROP TABLE candidatos; --` });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].fn, 'ats_listar_aplicaciones_paginadas');
  assert.equal(db.calls[0].args.p_pagina, 3);
  assert.equal(db.calls[0].args.p_limite, 10);
  assert.equal(result.total, 93);
  assert.equal(result.aplicaciones[0].ai_match_score, 0);
});

test('ATS-PAG: falla cerrado cuando RPC está ausente o devuelve datos inválidos', async () => {
  const db = mockDb({ ats_listar_aplicaciones_paginadas: { data: { total: '93', aplicaciones: [] }, error: null } });
  await assert.rejects(obtenerPaginaAts(db), /respuesta inválida/i);
  const dbError = mockDb({ ats_listar_aplicaciones_paginadas: { data: null, error: { code: 'PGRST202', message: 'not found' } } });
  await assert.rejects(obtenerPaginaAts(dbError), /not found|No fue posible/i);
});

test('ATS-MET: estadísticas calculadas exclusivamente desde RPC agregada', async () => {
  const stats = { total_aplicaciones: 1505, total_candidatos_unicos: 1440, pendientes_ia: 10, score_promedio_ia: 0, por_estado: [] };
  const db = mockDb({ ats_estadisticas_panel: { data: stats, error: null } });
  const data = await obtenerEstadisticasAts(db);
  assert.equal(data.total_aplicaciones, 1505);
  assert.equal(data.total_candidatos_unicos, 1440);
  assert.equal(data.score_promedio_ia, 0);
  assert.deepEqual(db.calls.map(c => c.fn), ['ats_estadisticas_panel']);
});

test('ATS-SQL: conteos globales, COUNT DISTINCT, cero IA y roles restringidos', () => {
  const sql = fs.readFileSync(path.resolve(base, 'supabase/21_ats_metrics_pagination.sql'), 'utf8');
  for (const pattern of [
    /COUNT\(DISTINCT a\.id_candidato\)/,
    /AVG\(a\.ai_match_score\)/,
    /ai_match_score IS NOT NULL/,
    /SECURITY DEFINER SET search_path = pg_catalog/gi,
    /REVOKE ALL ON FUNCTION public\.ats_estadisticas_panel\(\) FROM PUBLIC, anon, authenticated/,
    /REVOKE ALL ON FUNCTION public\.ats_listar_aplicaciones_paginadas/,
    /GRANT EXECUTE ON FUNCTION public\.ats_listar_aplicaciones_paginadas/,
    /LIMIT p_limite OFFSET \(p_pagina - 1\) \* p_limite/,
    /ORDER BY f\.ai_match_score DESC NULLS LAST, f\.id_aplicacion DESC/,
    /position\(lower\(v_busqueda\)/,
    /'tiene_cv', p\.tiene_cv/,
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /'url_archivo_cv'\s*,\s*p\./);
});

test('ATS-UI: búsqueda y filtro se ejecutan en API paginada con AbortController', () => {
  const html = fs.readFileSync(path.resolve(base, 'rrhh-frontend/candidatos.html'), 'utf8');
  const js = fs.readFileSync(path.resolve(base, 'rrhh-frontend/js/candidatos.js'), 'utf8');
  for (const id of ['buscador-ats', 'filtro-estado-ats', 'tamano-pagina-ats', 'btn-pagina-anterior-ats', 'btn-pagina-siguiente-ats', 'resumen-paginacion-ats']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(js, /new URLSearchParams/);
  assert.match(js, /new AbortController/);
  assert.match(js, /setTimeout\(\(\) =>/);
  assert.doesNotMatch(js, /aplicacionesGlobales\.filter\(/);
});

test('ATS-UI: dashboard distingue postulaciones, candidatos únicos y pendientes IA', () => {
  const html = fs.readFileSync(path.resolve(base, 'rrhh-frontend/dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.resolve(base, 'rrhh-frontend/js/dashboard.js'), 'utf8');
  assert.match(html, /Total de Postulaciones/);
  assert.doesNotMatch(html, /Total de Candidatos/);
  for (const id of ['stats-candidatos-unicos', 'stats-pendientes-ia', 'stats-promedio-ia', 'stats-etapas-ats']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, new RegExp(id));
  }
});

test('ATS-API: router mantiene autorización admin, no expone CV y devuelve paginación', async () => {
  const vm = require('node:vm');
  const codigo = fs.readFileSync(path.resolve(base, 'rrhh-backend/src/routes/admin.routes.js'), 'utf8');
  const rutas = {}, middlewares = [];
  const router = {
    use(...args) { middlewares.push(...args); },
    get(p, ...handlers) { rutas['GET ' + p] = handlers.at(-1); },
    post() {}, put() {}, delete() {},
  };
  const fake = {
    express: { Router: () => router }, bcrypt: {},
    multer: Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) }),
    '../config/supabase': {},
    '../middlewares/authMiddleware': 'verificarToken',
    '../middlewares/adminOnly': 'adminOnly',
    '../services/auditService': { registrarAuditoria: () => {} },
    '../services/atsService': {},
    '../services/atsReadService': {
      obtenerPaginaAts: async (db, query) => ({ total: 72, pagina: Number(query.pagina), limite: Number(query.limite),
        aplicaciones: [{ id_aplicacion: 9, estado_proceso: 'Recibida', tiene_cv: true, url_archivo_cv: '/privado/cv.pdf' }] }),
      obtenerEstadisticasAts: async () => ({ total_aplicaciones: 72 }),
    },
    '../services/storageService': {},
    '../constants/ats': { ATS_APPLICATION_STATES: ['Recibida'], transicionesPermitidas: () => ['En Revisión'] },
    '../utils/supabaseRetry': {},
    '../security/securityUtils': {}, '../services/orgValidation': {}, '../services/adminCatalogValidation': {},
  };
  const module = { exports: {} };
  const fn = vm.runInNewContext(`(function(require,module,exports) { ${codigo}\n})`, { console });
  fn(name => {
    if (!(name in fake)) throw new Error(name);
    return fake[name];
  }, module, module.exports);
  assert.deepEqual(middlewares, ['verificarToken', 'adminOnly']);
  const req = { query: { pagina: '3', limite: '10' } };
  const res = { json(body) { this.body = body; } };
  let nextError;
  await rutas['GET /aplicaciones'](req, res, error => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(res.body.total, 72);
  assert.equal(res.body.pagina, 3);
  assert.equal(res.body.paginas, 8);
  assert.equal(res.body.aplicaciones[0].url_archivo_cv, undefined);
  assert.equal(res.body.aplicaciones[0].tiene_cv, true);
  assert.equal(res.body.aplicaciones[0].transiciones_permitidas[0], 'En Revisión');
  const resStats = { json(body) { this.body = body; } };
  await rutas['GET /stats']({}, resStats, error => { nextError = error; });
  assert.equal(resStats.body.stats.total_aplicaciones, 72);
});

test('ATS-UI: dashboard no llama a un contador inexistente ni sobrescribe KPI con listados', () => {
  const js = fs.readFileSync(path.resolve(base, 'rrhh-frontend/js/dashboard.js'), 'utf8');
  assert.doesNotMatch(js, /cargarContadorAplicaciones\(/);
  assert.doesNotMatch(js, /if \(contadorVacantes\) contadorVacantes\.innerText = data\.total/);
  assert.doesNotMatch(js, /if \(contadorEmpleados\) contadorEmpleados\.innerText = data\.total/);
});
