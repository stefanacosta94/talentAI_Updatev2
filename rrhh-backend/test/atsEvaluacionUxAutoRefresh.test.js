'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '../../rrhh-frontend');
const codigo = fs.readFileSync(path.join(frontend, 'js/candidatos.js'), 'utf8');
const html = fs.readFileSync(path.join(frontend, 'candidatos.html'), 'utf8');

function prepararControlador(respuestas) {
  const elementos = new Map();
  const eventosDocumento = new Map();
  const eventosVentana = new Map();
  const temporizadores = new Map();
  let proximoTemporizador = 1;
  let llamadas = 0;
  const urls = [];

  function elemento(id) {
    if (elementos.has(id)) return elementos.get(id);
    const clases = new Set(id === 'modal-detalle-candidato' ? ['hidden'] : []);
    const eventos = {};
    const x = {
      id, value: '', dataset: {}, style: {}, disabled: false, textContent: '',
      classList: {
        contains(c) { return clases.has(c); },
        add(c) { clases.add(c); },
        remove(c) { clases.delete(c); },
        toggle(c, force) { if (force === undefined ? !clases.has(c) : force) clases.add(c); else clases.delete(c); },
      },
      addEventListener(nombre, fn) { eventos[nombre] = fn; },
      async disparar(nombre) { const fn = eventos[nombre]; if (fn) return await fn({ target: x, currentTarget: x }); },
      focus() {}, setAttribute() {}, removeAttribute() {},
      querySelectorAll() { return []; },
      appendChild(nodo) { this.filas.push(nodo); },
      filas: [],
    };
    let contenido = '';
    Object.defineProperty(x, 'innerHTML', {
      get() { return contenido; },
      set(valor) { contenido = valor; x.filas = []; },
    });
    elementos.set(id, x);
    return x;
  }

  const document = {
    hidden: false,
    activeElement: { closest() { return null; } },
    getElementById: elemento,
    createElement: () => ({ className: '', innerHTML: '' }),
    addEventListener(nombre, fn) { eventosDocumento.set(nombre, fn); },
    querySelectorAll() { return []; },
  };
  const window = {
    location: { replace() {} },
    addEventListener(nombre, fn) { eventosVentana.set(nombre, fn); },
  };
  const estado = {
    get llamadas() { return llamadas; }, urls, document, window, elemento,
    async ejecutarTimer() {
      const t = [...temporizadores.entries()][0];
      if (!t) return false;
      temporizadores.delete(t[0]);
      t[1].fn();
      await avanzarMicrotareas();
      return true;
    },
    get pendientes() { return [...temporizadores.values()]; },
    visibilidad(oculta) {
      document.hidden = oculta;
      eventosDocumento.get('visibilitychange')?.();
    },
    salir() { eventosVentana.get('pagehide')?.(); },
    async iniciar() {
      eventosDocumento.get('DOMContentLoaded')?.();
      await avanzarMicrotareas();
    },
  };

  async function avanzarMicrotareas() {
    for (let n = 0; n < 6; n++) await Promise.resolve();
  }

  const contexto = {
    document, window, console,
    URLSearchParams, AbortController, Number, JSON, Set,
    setTimeout(fn, ms) { const id = proximoTemporizador++; temporizadores.set(id, { fn, ms }); return id; },
    clearTimeout(id) { temporizadores.delete(id); },
    AuthService: { estaAutenticado: () => true, obtenerToken: () => 'token-demo', obtenerUsuario: () => ({ nombre: 'Administrador Prueba' }), cerrarSesion() {} },
    CONFIG: { API_URL: 'http://localhost:3000/api' },
    SecurityUtils: { escapeHTML: texto => String(texto ?? '') },
    NotificationService: { success() {}, error() {}, apiError() {} },
    DialogService: { confirm: async () => true },
    async fetch(url) {
      urls.push(String(url));
      const respuesta = respuestas[Math.min(llamadas, respuestas.length - 1)];
      llamadas++;
      if (respuesta instanceof Error) throw respuesta;
      return { ok: true, json: async () => ({ exito: true, total: respuesta.length, pagina: 1, limite: 20, aplicaciones: respuesta }) };
    },
  };
  vm.runInNewContext(codigo, contexto, { filename: 'candidatos.js' });
  return estado;
}

const registro = (puntaje, resumen = null) => ({
  id_aplicacion: 22, ai_match_score: puntaje, ai_resumen_habilidades: resumen,
  estado_proceso: 'En Revisión', candidatos: { nombre: 'Candidato', correo: 'candidato@example.com' },
  vacantes: { titulo: 'Cajero', departamentos: { nombre: 'Operaciones' } },
  transiciones_permitidas: ['Entrevista'], tiene_cv: true,
});

test('C06 IA UX: pendencia inicia polling de 15s, actualiza resultado y detiene consultas', async () => {
  for (const id of ['btn-actualizar-ats', 'ats-estado-actualizacion-ia']) assert.match(html, new RegExp(`id="${id}"`));
  const t = prepararControlador([[registro(null)], [registro('30.00', 'Resumen de Gemini')]]);
  await t.iniciar();
  assert.match(t.elemento('tabla-candidatos-body').filas[0].innerHTML, /Evaluación IA en proceso/);
  assert.equal(t.pendientes.length, 1);
  assert.equal(t.pendientes[0].ms, 15000);
  t.window.abrirDetalleCandidato(22);
  assert.equal(t.elemento('modal-match-candidato').textContent, 'En proceso');
  await t.ejecutarTimer();
  assert.equal(t.llamadas, 2);
  assert.match(t.elemento('tabla-candidatos-body').filas[0].innerHTML, /30% Match/);
  assert.equal(t.elemento('modal-match-candidato').textContent, '30%');
  assert.equal(t.elemento('modal-resumen-ia').textContent, 'Resumen de Gemini');
  assert.match(t.elemento('ats-estado-actualizacion-ia').textContent, /ya tienen resultado/);
  assert.equal(t.pendientes.length, 0);
  await t.elemento('btn-actualizar-ats').disparar('click');
  assert.equal(t.llamadas, 3);
  assert.equal(t.pendientes.length, 0);
});

test('C06 IA UX: pausa en pestaña oculta y reanuda visible sin temporizadores duplicados', async () => {
  const t = prepararControlador([[registro(null)]]);
  await t.iniciar();
  t.visibilidad(true);
  assert.equal(t.pendientes.length, 0);
  assert.match(t.elemento('ats-estado-actualizacion-ia').textContent, /pausada/);
  t.visibilidad(false);
  for (let n = 0; n < 6; n++) await Promise.resolve();
  assert.equal(t.llamadas, 2);
  assert.equal(t.pendientes.length, 1);
  t.salir();
  assert.equal(t.pendientes.length, 0);
});

test('C06 IA UX: un score 0 es una evaluación existente, no activa polling', async () => {
  const t = prepararControlador([[registro('0.00', 'Análisis completo')]]);
  await t.iniciar();
  assert.match(t.elemento('tabla-candidatos-body').filas[0].innerHTML, /0% Match/);
  assert.equal(t.pendientes.length, 0);
});
