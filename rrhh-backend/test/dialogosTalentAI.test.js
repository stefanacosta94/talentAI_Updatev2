'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '../../rrhh-frontend/js');
const config = fs.readFileSync(path.join(frontend, 'config.js'), 'utf8');
const source = config.match(/const DialogService = \(\(\) => \{[\s\S]*?\n\}\)\(\);/);
assert.ok(source, 'El servicio de diálogo debe existir en config.js');

class FakeElement {
  constructor(tag, owner) {
    this.tagName = tag;
    this.owner = owner;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.isConnected = false;
    this.open = false;
    this.hidden = false;
    this.value = '';
  }
  append(...children) {
    for (const child of children) { child.isConnected = true; this.children.push(child); }
  }
  appendChild(child) { this.append(child); return child; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, attrs = {}) {
    const ev = { target: this, preventDefault() { this.defaultPrevented = true; }, ...attrs };
    for (const fn of this.listeners[type] || []) fn(ev);
    return ev;
  }
  focus() { this.owner.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { this.isConnected = false; this.owner.body.children = this.owner.body.children.filter((v) => v !== this); }
}
function harness() {
  const doc = {
    activeElement: null,
    createElement(tag) { return new FakeElement(tag, doc); },
    getElementById(id) {
      return doc.head.children.find((v) => v.id === id) || null;
    },
  };
  doc.body = new FakeElement('body', doc);
  doc.head = new FakeElement('head', doc);
  const alerts = [];
  const service = vm.runInNewContext(`${source[0]}\nDialogService`, {
    document: doc,
    NotificationService: { error: (...args) => alerts.push(args) },
    Object,
    Number,
    String,
    Promise,
  });
  function dialog() { return doc.body.children.find((v) => v.tagName === 'dialog'); }
  function all(el) {
    return [el, ...(el?.children || []).flatMap(all)].filter(Boolean);
  }
  function buttons() { return all(dialog()).filter((v) => v.tagName === 'button'); }
  return { service, doc, dialog, all, buttons, alerts };
}

test('DIÁLOGOS: confirmar solo aprueba tras pulsar explícitamente el botón principal', async () => {
  const h = harness();
  const promise = h.service.confirm('¿Eliminar el documento?', { title: 'Eliminar documento', variant: 'danger', confirmText: 'Eliminar documento' });
  await new Promise(setImmediate);
  assert.equal(h.dialog().open, true);
  assert.equal(h.dialog().dataset.variant, 'danger');
  assert.equal(h.buttons()[0].owner.activeElement, h.buttons()[0], 'El foco inicial está en Cancelar');
  assert.equal(h.all(h.dialog()).some((el) => el.textContent === '¿Eliminar el documento?'), true);
  h.buttons()[1].fire('click');
  assert.equal(await promise, true);
  assert.equal(h.dialog(), undefined);
});

test('DIÁLOGOS: cancelar, Escape y clic fuera rechazan sin ejecutar mutaciones', async () => {
  const h = harness();
  let promise = h.service.confirm('¿Cancelar?');
  await new Promise(setImmediate);
  h.buttons()[0].fire('click');
  assert.equal(await promise, false);

  promise = h.service.confirm('¿Cancelar con Escape?');
  await new Promise(setImmediate);
  h.dialog().fire('cancel');
  assert.equal(await promise, false);

  promise = h.service.confirm('¿Cancelar fuera?');
  await new Promise(setImmediate);
  const dialog = h.dialog();
  dialog.fire('click');
  assert.equal(await promise, false);
});

test('DIÁLOGOS: serialización impide dos ventanas simultáneas', async () => {
  const h = harness();
  const first = h.service.confirm('Primero');
  const second = h.service.confirm('Segundo');
  await new Promise(setImmediate);
  assert.equal(h.doc.body.children.filter((v) => v.tagName === 'dialog').length, 1);
  h.buttons()[0].fire('click');
  assert.equal(await first, false);
  await new Promise(setImmediate);
  assert.equal(h.doc.body.children.filter((v) => v.tagName === 'dialog').length, 1);
  h.buttons()[1].fire('click');
  assert.equal(await second, true);
});

test('DIÁLOGOS: entrada de texto es opcional y valida requeridos', async () => {
  const h = harness();
  let promise = h.service.prompt('Escribe un nombre', { required: true });
  await new Promise(setImmediate);
  const input = h.all(h.dialog()).find((v) => v.tagName === 'input');
  h.buttons()[1].fire('click');
  assert.equal(h.dialog().open, true, 'No acepta campos obligatorios vacíos');
  input.value = '  Empleado  ';
  h.buttons()[1].fire('click');
  assert.equal(await promise, '  Empleado  ');

  promise = h.service.alert('Hecho');
  await new Promise(setImmediate);
  h.buttons()[0].fire('click');
  assert.equal(await promise, true);
});

test('DIÁLOGOS: todos los módulos administrativos evitan confirmaciones nativas', () => {
  for (const name of ['notificaciones', 'dashboard', 'conocimiento', 'usuarios', 'roles', 'cargos', 'departamentos', 'empleados']) {
    const code = fs.readFileSync(path.join(frontend, `${name}.js`), 'utf8');
    assert.match(code, /await DialogService\.confirm\(/, `${name} utiliza el servicio compartido`);
    assert.doesNotMatch(code, /(?<!\.)\b(?:window\.)?confirm\s*\(/, `${name} no invoca la confirmación nativa`);
  }
  assert.match(source[0], /\.textContent\s*=/, 'Las entradas se insertan como texto, sin HTML ejecutable');
  assert.match(source[0], /aria-labelledby/);
  assert.match(source[0], /aria-describedby/);
  assert.match(source[0], /:focus-visible/);
});
