'use strict';

const { normalizeEmail, isValidEmail } = require('../security/securityUtils');

const EMPLOYEE_STATES = new Set(['Activo', 'Inactivo']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanCargoName(value) {
  if (typeof value !== 'string') throw invalid('El nombre del cargo es obligatorio.');
  const nombre = value.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2 || nombre.length > 120) {
    throw invalid('El cargo debe tener entre 2 y 120 caracteres.');
  }
  return nombre;
}

function optionalPositiveInteger(value, label) {
  if (value === null || value === '') return null;
  // Rechazar 0, negativos, decimales, cadenas con formato inválido.
  const str = typeof value === 'number' ? String(value) : String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(str)) throw invalid(`${label} debe ser un identificador válido.`);
  const result = Number(str);
  if (!Number.isSafeInteger(result)) throw invalid(`${label} está fuera de rango.`);
  return result;
}

function optionalUserId(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalid('La cuenta seleccionada no es válida.');
  }
  return value.toLowerCase();
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function employeePayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Datos inválidos.');
  const output = {};
  const mandatory = ['nombre', 'correo', 'fecha_contratacion'];
  if (!partial && mandatory.some(key => body[key] === undefined || body[key] === null || String(body[key]).trim() === '')) {
    throw invalid('Nombre, correo y fecha de contratación son obligatorios.');
  }
  if (Object.hasOwn(body, 'nombre')) {
    if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.trim().length > 120) {
      throw invalid('El nombre debe tener entre 1 y 120 caracteres.');
    }
    output.nombre = body.nombre.trim();
  }
  if (Object.hasOwn(body, 'correo')) {
    const email = normalizeEmail(body.correo);
    if (!isValidEmail(email)) throw invalid('El correo electrónico no es válido.');
    output.correo = email;
  }
  if (Object.hasOwn(body, 'fecha_contratacion')) {
    if (!validDate(body.fecha_contratacion)) throw invalid('La fecha de contratación no es válida.');
    output.fecha_contratacion = body.fecha_contratacion;
  }
  if (Object.hasOwn(body, 'estado')) {
    if (!EMPLOYEE_STATES.has(body.estado)) throw invalid('El estado laboral debe ser Activo o Inactivo.');
    output.estado = body.estado;
  } else if (!partial) {
    output.estado = 'Activo';
  }
  for (const key of ['id_departamento', 'id_cargo']) {
    if (Object.hasOwn(body, key)) output[key] = optionalPositiveInteger(body[key], key);
    else if (!partial) output[key] = null;
  }
  if (Object.hasOwn(body, 'id_usuario')) output.id_usuario = optionalUserId(body.id_usuario);
  else if (!partial) output.id_usuario = null;
  if (Object.keys(output).length === 0) throw invalid('No hay campos válidos para actualizar.');
  return output;
}

function employeeWriteError(error) {
  if (error?.code === '23505') {
    return { status: 409, message: String(error.message || '').includes('id_usuario')
      ? 'Esa cuenta ya está vinculada a otro empleado.'
      : 'Ya existe un empleado con ese correo electrónico.' };
  }
  if (error?.code === '23503') return { status: 400, message: 'La cuenta, el departamento o el cargo seleccionado no existe.' };
  if (error?.code === '23514' || error?.code === '23502') return { status: 400, message: 'Hay datos obligatorios o valores no permitidos.' };
  return null;
}

module.exports = { cleanCargoName, optionalPositiveInteger, optionalUserId, employeePayload, employeeWriteError, validDate };
