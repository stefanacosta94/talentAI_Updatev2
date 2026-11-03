const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const frontend = path.resolve(__dirname, '../../rrhh-frontend');
const read = (name) => fs.readFileSync(path.join(frontend, name), 'utf8');

test('portal de candidatos contiene flujo real de postulación y no contenido comercial de captación', () => {
  const careers = read('careers.html');
  assert.match(careers, /id="form-aplicacion"/);
  assert.match(careers, /id="contenedor-vacantes"/);
  assert.match(careers, /js\/careers\.js/);
  assert.doesNotMatch(careers, /id="form-interes"/);
  assert.match(careers, /Perfil ficticio de demostración/);
});

test('página comercial no permite postular directamente pero ofrece enlaces al portal', () => {
  const marketing = read('plataforma.html');
  assert.match(marketing, /id="form-interes"/);
  assert.match(marketing, /id="oportunidades-destacadas"/);
  assert.doesNotMatch(marketing, /id="form-aplicacion"/);
  assert.match(marketing, /careers\.html#vacantes/);
  // Normalizar espacios para que el formateador HTML no rompa el texto de demostración.
  const marketingText = marketing.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.match(marketingText, /empresa, descripción y beneficios siguientes son ficticios/i);
});

test('lectura de vacantes compartida y validación PDF permanecen en sus módulos', () => {
  const api = read('js/public-vacantes.js');
  const careers = read('js/careers.js');
  assert.match(api, /GET/);
  assert.match(api, /public\/vacantes/);
  assert.match(careers, /public\/aplicar/);
  assert.match(careers, /new FormData\(/);
});

test('el CSS declara line-clamp estándar y prefijado para compatibilidad', () => {
  const css = read('css/careers-marketing.css');
  assert.match(css, /line-clamp:\s*3;\s*-webkit-line-clamp:\s*3;/);
  assert.match(css, /line-clamp:\s*2;\s*-webkit-line-clamp:\s*2;/);
});

test('GET público de vacantes reintenta consultas sin cambiar el POST de postulación', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/public.routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/vacantes'/);
  assert.match(source, /withSupabaseRetry/);
  assert.match(source, /router\.post\('\/aplicar',\s*upload\.single\('archivo_cv'\)/);
});
