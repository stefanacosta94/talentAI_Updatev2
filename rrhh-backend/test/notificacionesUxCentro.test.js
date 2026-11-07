'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const raiz = path.resolve(__dirname, '../..');
const ruta = fs.readFileSync(path.join(raiz, 'rrhh-backend/src/routes/notificaciones.routes.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'rrhh-frontend/notificaciones.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'rrhh-frontend/js/notificaciones.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'rrhh-frontend/css/notificaciones.css'), 'utf8');

function routerSimulado() {
  const handlers = new Map();
  const queries = [];
  const registros = [
    { id_notificacion: 'a', nombre_candidato: 'Juan Perez', destinatario_email: 'juan@example.com',
      tipo_evento: 'postulacion_recibida', estado: 'pendiente', auto_resend_autorizado: false,
      prueba_resend_autorizada: false, creado_en: '2026-11-06T22:31:00Z' },
    { id_notificacion: 'b', nombre_candidato: 'Maria Lopez', destinatario_email: 'maria@example.com',
      tipo_evento: 'en_revision', estado: 'aceptado_proveedor', auto_resend_autorizado: true,
      prueba_resend_autorizada: true, creado_en: '2026-11-06T22:29:00Z' },
    { id_notificacion: 'c', nombre_candidato: 'Juan Perez', destinatario_email: 'juan@example.com',
      tipo_evento: 'entrevista', estado: 'fallido', auto_resend_autorizado: false,
      prueba_resend_autorizada: true, creado_en: '2026-11-06T22:20:00Z' },
  ];
  const supabase = {
    from(table) {
      assert.equal(table, 'notificaciones_email');
      const q = { filtros: [], orden: null, rango: null, campo: null, opciones: null,
        select(campos, opciones) { this.campo = campos; this.opciones = opciones; return this; },
        eq(campo, valor) { this.filtros.push([campo, valor]); return this; },
        or(filtro) { this.orFiltro = filtro; return this; },
        order(campo) { this.orden = campo; return this; },
        range(inicio, fin) { this.rango = [inicio, fin]; return this; },
        limit(cuantos) { this.tope = cuantos; return this; },
        then(resolve) {
          queries.push(this);
          let rows = registros.filter(row => this.filtros.every(([col, val]) => row[col] === val));
          if (this.orFiltro) {
            const match = this.orFiltro.match(/^nombre_candidato\.ilike\.%(.+)%?,destinatario_email\.ilike\.%(.+)%?$/);
            assert.ok(match, 'La búsqueda debe generar filtros controlados');
            const needle = match[1].replace(/%$/, '').toLowerCase();
            rows = rows.filter(row => row.nombre_candidato.toLowerCase().includes(needle) || row.destinatario_email.toLowerCase().includes(needle));
          }
          if (this.orden === 'creado_en') rows = [...rows].sort((a, b) => b.creado_en.localeCompare(a.creado_en));
          const count = rows.length;
          if (this.rango) rows = rows.slice(this.rango[0], this.rango[1] + 1);
          if (this.tope) rows = rows.slice(0, this.tope);
          resolve({ data: this.opciones?.head ? null : rows, count, error: null });
        },
      };
      return q;
    },
  };
  const router = {
    use() {},
    get(endpoint, handler) { handlers.set(`GET ${endpoint}`, handler); },
    post(endpoint, handler) { handlers.set(`POST ${endpoint}`, handler); },
  };
  const requireMock = name => {
    if (name === 'express') return { Router: () => router };
    if (name === '../config/supabase') return supabase;
    if (name === '../middlewares/authMiddleware') return () => {};
    if (name === '../middlewares/adminOnly') return () => {};
    if (name === '../utils/supabaseRetry') return { withSupabaseRetry: fn => Promise.resolve(fn()), createSupabaseError: e => e };
    if (name === '../services/mailTemplates') return { EVENTOS: { postulacion_recibida: {}, en_revision: {}, entrevista: {}, contratado: {}, descartado: {} }, renderEmail: () => ({}) };
    if (name === '../services/notificationProcessor') return { procesarLote: () => ({}), safeCount: n => n };
    if (name === '../services/resendTestProcessor') return { procesarUnaPrueba: () => ({}) };
    if (name === '../services/resendTestTransport') return { configResendTest: () => ({}) };
    if (name === '../services/resendAutoWorker') return { configResendAuto: () => ({}) };
    if (name === '../services/resendWebhookService') return { configuracionWebhook: () => ({}) };
    if (name === '../services/auditService') return { registrarAuditoria: () => {} };
    throw Error(`Importación inesperada: ${name}`);
  };
  const module = { exports: {} };
  const run = vm.runInNewContext(`(function(require,module,exports,process) { ${ruta}\n })`, {});
  run(requireMock, module, module.exports, { env: {} });
  async function consultar(endpoint, query = {}) {
    const handler = handlers.get(`GET ${endpoint}`);
    assert.ok(handler, `Falta ruta ${endpoint}`);
    const response = { statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let err;
    await handler({ query }, response, error => { err = error; });
    if (err) throw err;
    return response;
  }
  return { consultar, queries };
}

test('UX: resumen global obtiene cantidades reales sin descargar todos los registros', async () => {
  const { consultar, queries } = routerSimulado();
  const res = await consultar('/resumen');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.pendientes, 1);
  assert.equal(res.body.aceptados, 1);
  assert.equal(res.body.fallidos, 1);
  assert.equal(res.body.revision, 0);
  assert.equal(res.body.ultimo_evento_en, '2026-11-06T22:31:00Z');
  assert.equal(queries.filter(q => q.opciones?.head).length, 8);
  assert.equal(res.body.entregado, 0);
  assert.equal(res.body.rebotado, 0);
});

test('UX: filtros del listado se aplican en Supabase antes de paginar', async () => {
  const { consultar, queries } = routerSimulado();
  const res = await consultar('/', { pagina: '1', limite: '20', estado: 'aceptado_proveedor',
    evento: 'en_revision', modo: 'automatico', buscar: 'maria' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.registros.length, 1);
  const query = queries.at(-1);
  assert.ok(query.filtros.some(([key, val]) => key === 'auto_resend_autorizado' && val === true));
  assert.ok(query.filtros.some(([key, val]) => key === 'tipo_evento' && val === 'en_revision'));
  assert.deepEqual(Array.from(query.rango), [0, 19]);
});

test('UX: el filtro prueba manual exige opt-in de Resend y no automático', async () => {
  const { consultar } = routerSimulado();
  const res = await consultar('/', { modo: 'prueba_manual' });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.registros[0].id_notificacion, 'c');
});

test('UX: búsquedas con sintaxis PostgREST peligrosa se rechazan sin consultas', async () => {
  const { consultar, queries } = routerSimulado();
  for (const buscar of ['juan,estado.eq.pendiente', 'Juan%)', '%.%', 'a'.repeat(81)]) {
    const res = await consultar('/', { buscar });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(queries.length, 0);
});

test('UX: eventos y modos no reconocidos se rechazan', async () => {
  const { consultar } = routerSimulado();
  for (const query of [{ evento: 'vacante_borrada' }, { modo: 'produccion' }]) {
    const res = await consultar('/', query);
    assert.equal(res.statusCode, 400);
  }
});

test('UX: resumen y filtros son rutas GET bajo los mismos middlewares admin', () => {
  assert.match(ruta, /router\.use\(verificarToken, adminOnly\)/);
  assert.match(ruta, /router\.get\(['"]\/resumen['"]/);
  assert.match(ruta, /router\.get\(['"]\/['"]/);
  assert.doesNotMatch(ruta, /RESEND_API_KEY/);
});

test('UX: elimina la advertencia de fase y conserva texto explícito de seguridad', () => {
  assert.match(html, /Centro de notificaciones ATS/);
  assert.doesNotMatch(html, /Fase\s*[58][A-D]|Procesamiento simulado/);
  assert.match(html, /el envío a candidatos reales permanece desactivado/i);
  assert.match(html, /aceptación de Resend no confirma la entrega/i);
});

test('UX: componentes, filtros, detalle e historial están conectados', () => {
  for (const id of ['total-notificaciones','kpi-pendientes','kpi-aceptados','kpi-fallidos',
    'filtro-notificaciones-estado','filtro-notificaciones-evento','filtro-notificaciones-modo',
    'buscar-notificaciones','dialog-detalle','dialog-intentos','plantilla-preview']) {
    assert.ok(html.includes(`id="${id}"`), `Elemento faltante ${id}`);
  }
  assert.match(js, /mostrarDetalle\(n\)/);
  assert.match(js, /cargarResumen\(\)/);
  assert.match(js, /parametrosListado\(\)/);
});

test('UX: conserva acciones de 8A en detalle, no envía correos al consultar', () => {
  for (const action of ['autorizar-prueba-resend','autorizar-auto-resend','revocar-auto-resend','aprobar','cancelar','reprogramar']) {
    assert.ok(js.includes(action));
  }
  assert.match(js, /await DialogService\.confirm\(CONFIRMACIONES\[accion\]/);
  assert.match(js, /\/procesar-resend-prueba/);
  assert.match(js, /btnResend\.hidden = !pruebas \|\| !resendConfigurado/);
});

test('UX: HTML no inserta datos de candidatos con innerHTML ni concede permisos al iframe', () => {
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /\.textContent\s*=/);
  assert.match(html, /id="plantilla-preview"[^>]*sandbox=""/);
});

test('UX: estilos aislados admiten pantalla pequeña y botones ocultos', () => {
  assert.match(html, /css\/notificaciones\.css/);
  assert.match(css, /\.nc-main\s*\[hidden\]/);
  // Ambos patrones aceptan CSS minificado o formateado por Prettier/VS Code.
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*720px\s*\)/);
  assert.match(css, /\.nc-table-scroll\s*\{\s*overflow-x\s*:\s*auto\s*;/);
});
