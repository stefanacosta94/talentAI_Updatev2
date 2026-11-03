const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const backend = fs.readFileSync(
  path.join(__dirname, "../src/routes/admin.routes.js"),
  "utf8",
);
const html = fs.readFileSync(
  path.join(__dirname, "../../rrhh-frontend/conocimiento.html"),
  "utf8",
);

test("edición de documentos admite PUT multipart con archivo opcional", () => {
  assert.match(
    backend,
    /router\.put\s*\(\s*['"]\/documentos\/:id['"]\s*,\s*upload\.single\(['"]archivo_documento['"]\)/,
  );
});

test("aviso informativo ocupa el ancho del módulo", () => {
  assert.match(html, /Información contextual: ancho completo/);
  assert.match(html, /aria-labelledby="info-conocimiento-titulo"/);
});

test("no existe el disclaimer inferior del asistente", () => {
  assert.doesNotMatch(html, /El chat tiene su propia vista, independiente/);
  assert.doesNotMatch(html, /Abrir asistente<\/a>/);
});
