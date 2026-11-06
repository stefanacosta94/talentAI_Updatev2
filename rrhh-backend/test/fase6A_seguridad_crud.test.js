'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decidirAccesoChat } = require('../src/services/chatAccessPolicy');
const { limpiarNombreDepartamento, validarIdUsuario, validarEdicionUsuario } = require('../src/services/adminCatalogValidation');

const routesDir = path.join(__dirname, '..', 'src', 'routes');

function loadCommonJS(source, requireMock, env = {}) {
  const code = fs.readFileSync(source, 'utf8');
  const module = { exports: {} };
  const run = vm.runInNewContext('(function(require, module, exports, process) {\n' + code + '\n})', { console, Buffer, setTimeout });
  run(requireMock, module, module.exports, { env });
  return module.exports;
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(n) { this.statusCode = n; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

function makeChatOnly(lookup) {
  const db = {
    from(table) {
      let id;
      return {
        select() { return this; },
        eq(col, val) { assert.equal(col, table === 'usuarios' ? 'id' : 'id_usuario'); id = val; return this; },
        maybeSingle() { return Promise.resolve(lookup(table, id)); },
      };
    },
  };
  return loadCommonJS(path.join(__dirname, '..', 'src', 'middlewares', 'chatOnly.js'), name => {
    if (name === '../config/supabase') return db;
    if (name === '../utils/supabaseRetry') return { withSupabaseRetry: fn => fn(), createSupabaseError: error => error };
    if (name === '../services/chatAccessPolicy') return { decidirAccesoChat };
    throw new Error('Unexpected import ' + name);
  });
}

async function runChat(handler, id = 'user-uuid') {
  const req = { usuario: { id, rol: 'admin' } }; // claim is intentionally stale
  const res = fakeResponse();
  let nextCalled = false, nextError;
  await handler(req, res, err => { nextCalled = true; nextError = err; });
  return { req, res, nextCalled, nextError };
}

test('6A: el asistente solo admite administrador vigente o empleado vinculado y activo', () => {
  assert.equal(decidirAccesoChat({ rol: 'admin' }, null).permitido, true);
  assert.equal(decidirAccesoChat({ rol: 'empleado' }, { id_empleado: 1, estado: 'Activo' }).permitido, true);
  assert.equal(decidirAccesoChat({ rol: 'empleado' }, null).status, 403);
  assert.equal(decidirAccesoChat({ rol: 'empleado' }, { estado: 'Inactivo' }).status, 403);
  assert.equal(decidirAccesoChat({ rol: 'superuser' }, null).status, 403);
  assert.equal(decidirAccesoChat(null, null).status, 401);
});

test('6A: middleware deniega cuenta de JWT obsoleto que ahora es empleado no vinculado', async () => {
  const handler = makeChatOnly(table => ({ data: table === 'usuarios' ? { id: 'user-uuid', rol: 'empleado' } : null, error: null }));
  const result = await runChat(handler);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('6A: middleware autoriza empleado activo enlazado y no autoriza inactivo', async () => {
  const handler = makeChatOnly(table => ({ data: table === 'usuarios' ? { rol: 'empleado' } : { id_empleado: 7, estado: 'Activo' }, error: null }));
  const ok = await runChat(handler);
  assert.equal(ok.nextCalled, true);
  assert.equal(ok.req.usuario.id_empleado, 7);
  assert.equal(ok.req.usuario.rol, 'empleado');
  const handler2 = makeChatOnly(table => ({ data: table === 'usuarios' ? { rol: 'empleado' } : { id_empleado: 7, estado: 'Inactivo' }, error: null }));
  const denied = await runChat(handler2);
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.nextCalled, false);
});

test('6A: middleware confía en rol administrador actual, no en JWT antiguo', async () => {
  const handler = makeChatOnly(table => {
    assert.equal(table, 'usuarios');
    return { data: { rol: 'admin' }, error: null };
  });
  const ok = await runChat(handler);
  assert.equal(ok.nextCalled, true);
  assert.equal(ok.req.usuario.rol, 'admin');
});

test('6A: falla de Supabase no se interpreta como autorización', async () => {
  const handler = makeChatOnly(() => ({ data: null, error: new Error('Base de datos no disponible') }));
  const result = await runChat(handler);
  assert.equal(result.nextCalled, true);
  assert.match(result.nextError.message, /Base de datos no disponible/);
  assert.equal(result.res.body, null);
});

test('6A: la ruta RAG exige JWT y middleware de vínculo antes de consultar documentos', () => {
  const source = fs.readFileSync(path.join(routesDir, 'rag.routes.js'), 'utf8');
  // La protección se verifica sin depender del estilo de comillas ni del formateador.
  const rutaProtegida = /router\s*\.\s*post\s*\(\s*(['"])\/chat\1\s*,\s*verificarToken\s*,\s*chatOnly\s*,\s*async\b/;
  assert.match(source, rutaProtegida);
  const posicionRuta = source.search(rutaProtegida);
  const posicionConsulta = source.search(/\.from\s*\(\s*(['"])base_conocimiento\1\s*\)/);
  assert.ok(posicionConsulta > posicionRuta, 'La consulta documental debe ejecutarse dentro de la ruta protegida');
});

test('6A: ATS interno requiere rol admin verificado en BD', () => {
  const source = fs.readFileSync(path.join(routesDir, 'ats.routes.js'), 'utf8');
  assert.match(source, /router\.post\('\/evaluar', verificarToken, adminOnly, upload\.single/);
});

test('6A: registro público cerrado por defecto y opt-in nunca permite elegir rol', () => {
  const source = fs.readFileSync(path.join(routesDir, 'auth.routes.js'), 'utf8');
  assert.match(source, /PUBLIC_EMPLOYEE_REGISTRATION_ENABLED !== 'true'/);
  assert.match(source, /rol: 'empleado'/);
  const registro = {};
  const router = { post(route, ...fns) { registro[route] = fns.at(-1); } };
  const fn = loadCommonJS(path.join(routesDir, 'auth.routes.js'), name => {
    if (name === 'express') return { Router: () => router };
    if (name === 'bcrypt') return {};
    if (name === 'jsonwebtoken') return {};
    if (name === 'express-rate-limit') return () => () => {};
    if (name === '../config/supabase') return {};
    if (name === '../security/securityUtils') return {};
    throw new Error(name);
  }, {});
  assert.equal(fn, router);
  const res = fakeResponse();
  registro['/registrar']({ body: {} }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('6A: se normalizan departamentos y se rechazan nombres inválidos', () => {
  assert.equal(limpiarNombreDepartamento('  Gestión   Humana  '), 'Gestión Humana');
  assert.throws(() => limpiarNombreDepartamento('a'), /2 y 120/);
  assert.throws(() => limpiarNombreDepartamento(' '.repeat(5)), /2 y 120/);
  assert.throws(() => limpiarNombreDepartamento('X'.repeat(121)), /2 y 120/);
});

test('6A: validación de cambios de usuario: correo, contraseña opcional y rol bloqueado', () => {
  const valid = validarEdicionUsuario({ nombre: '  María  López ', email: '  MARIA@EXAMPLE.COM  ', password: '' });
  assert.deepEqual(valid.changes, { nombre: 'María López', email: 'maria@example.com' });
  assert.equal(valid.nuevaContrasena, undefined);
  assert.equal(validarEdicionUsuario({ password: 'ClaveSuperSegura9!' }).nuevaContrasena, 'ClaveSuperSegura9!');
  assert.throws(() => validarEdicionUsuario({ rol: 'admin' }), /rol se modifica/);
  assert.throws(() => validarEdicionUsuario({ password_hash: 'bad' }), /solo admite/);
  assert.throws(() => validarEdicionUsuario({ password: 'corta' }), /8 y 128/);
  assert.throws(() => validarEdicionUsuario({ password: '' }), /No hay campos/);
  assert.throws(() => validarEdicionUsuario({ email: 'correo-invalido' }), /válido/);
  assert.equal(validarIdUsuario('12345678-1234-1234-1234-1234567890AB'), '12345678-1234-1234-1234-1234567890ab');
  assert.throws(() => validarIdUsuario('abc'), /ID de usuario inválido/);
});

function makeAdminRoutes(responseForOperation) {
  const routes = new Map(), middleware = [];
  const router = {
    use(...args) { middleware.push(args); },
    get(route, ...handlers) { routes.set('GET ' + route, handlers.at(-1)); },
    post(route, ...handlers) { routes.set('POST ' + route, handlers.at(-1)); },
    put(route, ...handlers) { routes.set('PUT ' + route, handlers.at(-1)); },
    delete(route, ...handlers) { routes.set('DELETE ' + route, handlers.at(-1)); },
  };
  const calls = [], audits = [];
  const db = {
    from(table) {
      const call = { table, filters: {} }; calls.push(call);
      const builder = {
        select(fields, opts) { call.fields = fields; call.opts = opts; return this; },
        insert(items) { call.operation = 'insert'; call.items = items; return this; },
        update(data) { call.operation = 'update'; call.data = data; return this; },
        delete() { call.operation = 'delete'; return this; },
        eq(col, val) { call.filters[col] = val; return this; },
        maybeSingle() { return Promise.resolve(responseForOperation(call)); },
        single() { return Promise.resolve(responseForOperation(call)); },
        then(ok, err) { return Promise.resolve(responseForOperation(call)).then(ok, err); },
      };
      return builder;
    },
  };
  loadCommonJS(path.join(routesDir, 'admin.routes.js'), name => {
    if (name === 'express') return { Router: () => router };
    if (name === 'bcrypt') return { hash: async password => `hashed::${password}` };
    if (name === 'multer') return Object.assign(() => ({ single: () => () => {} }), { memoryStorage: () => ({}) });
    if (name === '../config/supabase') return db;
    if (name === '../middlewares/authMiddleware') return function verificarToken() {};
    if (name === '../middlewares/adminOnly') return function adminOnly() {};
    if (name === '../services/auditService') return { registrarAuditoria: async (...args) => { audits.push(args); } };
    if (name === '../services/atsService') return {};
    if (name === '../services/storageService') return {};
    if (name === '../constants/ats') return { ATS_APPLICATION_STATES: [] };
    if (name === '../utils/supabaseRetry') return { withSupabaseRetry: op => op(), createSupabaseError: error => error };
    if (name === '../security/securityUtils') return require('../src/security/securityUtils');
    if (name === '../services/orgValidation') return require('../src/services/orgValidation');
    if (name === '../services/adminCatalogValidation') return require('../src/services/adminCatalogValidation');
    throw new Error('Unexpected import ' + name);
  });
  async function request(method, route, { params = {}, body = {} } = {}) {
    const handler = routes.get(method + ' ' + route);
    assert.ok(handler, `Missing ${method} ${route}`);
    const res = fakeResponse();
    let nextError;
    await handler({ params, body, usuario: { id: '12345678-1234-1234-1234-1234567890ab' } }, res, err => { nextError = err; });
    if (nextError) throw nextError;
    return res;
  }
  return { routes, middleware, calls, audits, request };
}

test('6A: el panel registra CRUD de departamentos y edición de usuario bajo adminOnly', () => {
  const app = makeAdminRoutes(() => ({ data: null, error: null }));
  for (const url of ['POST /departamentos', 'PUT /departamentos/:id', 'DELETE /departamentos/:id', 'PUT /usuarios/:id']) assert.ok(app.routes.has(url), url);
  assert.equal(app.middleware.length, 1);
  assert.equal(app.middleware[0].length, 2);
});

test('6A: crear departamento válido, registrar auditoría y rechazar duplicado', async () => {
  let conflict = false;
  const app = makeAdminRoutes(call => conflict ? { data: null, error: { code: '23505' } } : { data: { id_departamento: 4, nombre: call.items[0].nombre }, error: null });
  const created = await app.request('POST', '/departamentos', { body: { nombre: '  Gestión  Humana ' } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.departamento.nombre, 'Gestión Humana');
  assert.equal(app.audits.length, 1);
  conflict = true;
  const duplicate = await app.request('POST', '/departamentos', { body: { nombre: 'Gestión Humana' } });
  assert.equal(duplicate.statusCode, 409);
});

test('6A: edición de departamento informa inexistencia y no altera otros registros', async () => {
  const app = makeAdminRoutes(() => ({ data: null, error: null }));
  const notFound = await app.request('PUT', '/departamentos/:id', { params: { id: '14' }, body: { nombre: 'Finanzas' } });
  assert.equal(notFound.statusCode, 404);
  assert.equal(app.calls[0].filters.id_departamento, 14);
  assert.equal((await app.request('PUT', '/departamentos/:id', { params: { id: '-2' }, body: { nombre: 'Finanzas' } })).statusCode, 400);
});

test('6A: impide eliminar departamentos vinculados a empleados o vacantes', async () => {
  const app = makeAdminRoutes(call => call.table === 'empleados' ? { count: 1, error: null } : { count: 0, error: null });
  const result = await app.request('DELETE', '/departamentos/:id', { params: { id: '9' } });
  assert.equal(result.statusCode, 409);
  assert.equal(app.calls.some(call => call.operation === 'delete'), false);
});

test('6A: usuario puede cambiar nombre, correo y clave sin modificar rol ni devolver hash', async () => {
  const app = makeAdminRoutes(call => ({ data: { id: call.filters.id, nombre: call.data.nombre, email: call.data.email, rol: 'empleado' }, error: null }));
  const id = '12345678-1234-1234-1234-1234567890aa';
  const result = await app.request('PUT', '/usuarios/:id', { params: { id }, body: { nombre: '  José  López ', email: ' JOSE@EXAMPLE.COM ', password: 'Password1234!' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.usuario.email, 'jose@example.com');
  assert.equal(app.calls[0].data.password_hash, 'hashed::Password1234!');
  assert.equal(app.calls[0].data.rol, undefined);
  assert.equal(result.body.usuario.password_hash, undefined);
  assert.equal(app.audits.length, 1);
});

test('6A: contraseña opcional no altera hash y rol inyectado se rechaza', async () => {
  const app = makeAdminRoutes(call => ({ data: { id: call.filters.id, rol: 'empleado', nombre: call.data.nombre }, error: null }));
  const id = '12345678-1234-1234-1234-1234567890aa';
  assert.equal((await app.request('PUT', '/usuarios/:id', { params: { id }, body: { nombre: 'Carlos', password: '' } })).statusCode, 200);
  assert.equal(app.calls[0].data.password_hash, undefined);
  const denied = await app.request('PUT', '/usuarios/:id', { params: { id }, body: { rol: 'admin' } });
  assert.equal(denied.statusCode, 400);
  assert.equal(app.calls.length, 1);
});

test('6A: edición rechaza correo duplicado y eliminación de usuario inexistente', async () => {
  const id = '12345678-1234-1234-1234-1234567890aa';
  const app = makeAdminRoutes(call => call.operation === 'update' ? { error: { code: '23505' } } : { data: null, error: null });
  const conflict = await app.request('PUT', '/usuarios/:id', { params: { id }, body: { email: 'duplicado@example.com' } });
  assert.equal(conflict.statusCode, 409);
  const missing = await app.request('DELETE', '/usuarios/:id', { params: { id } });
  assert.equal(missing.statusCode, 404);
});
