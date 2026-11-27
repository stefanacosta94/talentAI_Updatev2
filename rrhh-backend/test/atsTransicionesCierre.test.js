'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ATS_APPLICATION_STATES, transicionesPermitidas } = require('../src/constants/ats');

const root = path.join(__dirname, '..');
function cargar(file, mocks) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const fn = vm.runInNewContext(`(function (require, module, exports) { ${source}\n})`, { console });
  fn(name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, module, module.exports);
  return module.exports;
}

function entornoAdmin(resultado = 'actualizada') {
  const routes = {};
  const llamadas = [];
  const fakeRouter = {
    use() {}, get() {}, post() {}, delete() {},
    put(url, ...handlers) { routes[url] = handlers.at(-1); },
  };
  const db = {
    rpc(nombre, params) {
      llamadas.push([nombre, params]);
      return Promise.resolve({ error: null, data: [{ resultado,
        estado_anterior: 'En Revisión', estado_nuevo: resultado === 'actualizada' ? params.p_estado : 'En Revisión' }] });
    },
  };
  cargar('src/routes/admin.routes.js', {
    express: { Router: () => fakeRouter },
    bcrypt: {},
    multer: Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) }),
    '../config/supabase': db,
    '../middlewares/authMiddleware': () => {},
    '../middlewares/adminOnly': () => {},
    '../services/auditService': { registrarAuditoria: async () => {} },
    '../services/atsService': {},
    '../services/storageService': {},
    '../constants/ats': { ATS_APPLICATION_STATES, transicionesPermitidas },
    '../utils/supabaseRetry': { withSupabaseRetry: f => f(), createSupabaseError: e => e },
    '../security/securityUtils': require('../src/security/securityUtils'),
    '../services/orgValidation': require('../src/services/orgValidation'),
    '../services/adminCatalogValidation': require('../src/services/adminCatalogValidation'),
  });
  const handler = routes['/aplicaciones/:id/estado'];
  async function actualizar(estado = 'Entrevista') {
    const req = { params: { id: '57' }, body: { estado_proceso: estado }, usuario: { id: '12345678-1234-1234-1234-1234567890ab' } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    let error;
    await handler(req, res, e => { error = e; });
    if (error) throw error;
    return res;
  }
  return { actualizar, llamadas };
}

test('ATS-ESTADOS: política es finita, no permite saltos ni reabrir terminales', () => {
  assert.deepEqual([...transicionesPermitidas('Recibida')], ['En Revisión', 'Descartado']);
  assert.deepEqual([...transicionesPermitidas('En Revisión')], ['Entrevista', 'Descartado']);
  assert.equal(transicionesPermitidas('Entrevista').includes('En Revisión'), true);
  assert.equal(transicionesPermitidas('Contratado').length, 0);
  assert.equal(transicionesPermitidas('Descartado').length, 0);
  assert.equal(transicionesPermitidas('estado inventado').length, 0);
});

test('ATS-ESTADOS: endpoint llama solo RPC atómica con actor real JWT revalidado', async () => {
  const app = entornoAdmin();
  const res = await app.actualizar('Entrevista');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aplicacion.estado_proceso, 'Entrevista');
  assert.equal(app.llamadas[0][0], 'ats_cambiar_estado_auditado');
  assert.equal(app.llamadas[0][1].p_id_aplicacion, 57);
  assert.equal(app.llamadas[0][1].p_id_usuario, '12345678-1234-1234-1234-1234567890ab');
});

test('ATS-ESTADOS: transición no permitida es conflicto 409', async () => {
  const app = entornoAdmin('transicion_invalida');
  const res = await app.actualizar('Contratado');
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.transiciones_permitidas.includes('Entrevista'));
});

test('ATS-ESTADOS: estado inexistente se rechaza antes de llegar a PostgreSQL', async () => {
  const app = entornoAdmin();
  const res = await app.actualizar('Borrado');
  assert.equal(res.statusCode, 400);
  assert.equal(app.llamadas.length, 0);
});

test('ATS-ESTADOS: RPC debe bloquear fila, modificar estado y auditar en transacción', () => {
  const sql = fs.readFileSync(path.join(root, '../supabase/19_ats_transiciones_auditadas.sql'), 'utf8');
  assert.match(sql, /FOR UPDATE;/);
  assert.match(sql, /UPDATE public\.aplicaciones_ats/);
  assert.match(sql, /INSERT INTO public\.bitacora_auditoria/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ats_cambiar_estado_auditado/);
  assert.match(sql, /WHEN 'Entrevista' THEN p_estado IN/);
  const frontend = fs.readFileSync(path.join(root, '../rrhh-frontend/js/candidatos.js'), 'utf8');
  assert.match(frontend, /transiciones_permitidas/);
  assert.match(frontend, /boton\.disabled = !puedeCambiar/);
});

test('ATS-AUDITORIA: comprueba Supabase.error antes de anunciar éxito', async () => {
  const registros = [];
  const servicio = cargar('src/services/auditService.js', {
    '../config/supabase': { from() { return { async insert() { registros.push(1); return { error: { code: 'DB_ERROR' } }; } }; } },
  });
  assert.equal(await servicio.registrarAuditoria('id', 'acción', 'modulo', 'detalle'), false);
  assert.equal(registros.length, 1);
});
