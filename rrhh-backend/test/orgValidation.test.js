const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanCargoName, optionalPositiveInteger, optionalUserId,
  employeePayload, employeeWriteError, validDate,
} = require('../src/services/orgValidation');

test('cargo: normaliza espacios y descarta nombres vacíos', () => {
  assert.equal(cleanCargoName('  Jefe  de   RRHH '), 'Jefe de RRHH');
  assert.throws(() => cleanCargoName(' '), /entre 2 y 120/);
});

test('IDs opcionales: permite NULL y valida enteros positivos', () => {
  assert.equal(optionalPositiveInteger('', 'cargo'), null);
  assert.equal(optionalPositiveInteger('42', 'cargo'), 42);
  for (const invalid of ['0', '-1', '1.2', 'texto', '9007199254740993']) {
    assert.throws(() => optionalPositiveInteger(invalid, 'cargo'));
  }
});

test('vinculación explícita: UUID o NULL sin inferir por correo', () => {
  assert.equal(optionalUserId(''), null);
  assert.equal(optionalUserId('7A3F1234-9C11-4A11-BBBC-001122334455'), '7a3f1234-9c11-4a11-bbbc-001122334455');
  assert.throws(() => optionalUserId('123'));
});

test('fecha válida: rechaza días imposibles', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
});

test('alta de empleado: valida campos y normaliza correo', () => {
  const value = employeePayload({ nombre: ' Persona  Prueba ', correo: ' PERSONA@EXAMPLE.COM ', fecha_contratacion: '2026-10-30' });
  assert.equal(value.correo, 'persona@example.com');
  assert.equal(value.id_usuario, null);
  assert.equal(value.id_cargo, null);
  assert.equal(value.estado, 'Activo');
});

test('actualización parcial no desvincula una cuenta existente', () => {
  const result = employeePayload({ estado: 'Inactivo' }, { partial: true });
  assert.deepEqual(result, { estado: 'Inactivo' });
  assert.throws(() => employeePayload({ estado: 'Despedido' }, { partial: true }));
});

test('errores de integridad: vínculo duplicado se interpreta como conflicto', () => {
  assert.equal(employeeWriteError({ code: '23505', message: 'empleados_id_usuario_unique' }).status, 409);
  assert.equal(employeeWriteError({ code: '23503' }).status, 400);
});
