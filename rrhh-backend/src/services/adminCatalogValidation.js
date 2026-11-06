'use strict';

const { normalizeEmail, isValidEmail, isStrongEnoughPassword } = require('../security/securityUtils');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validarIdUsuario(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw invalid('ID de usuario inválido.');
  return id.toLowerCase();
}

function limpiarNombreDepartamento(value) {
  if (typeof value !== 'string') throw invalid('El nombre del departamento es obligatorio.');
  const nombre = value.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2 || nombre.length > 120) {
    throw invalid('El departamento debe tener entre 2 y 120 caracteres.');
  }
  return nombre;
}

function validarEdicionUsuario(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Datos de usuario inválidos.');
  const keys = Object.keys(body);
  if (keys.some(key => !['nombre', 'email', 'password'].includes(key))) {
    throw invalid('La edición solo admite nombre, email y contraseña. El rol se modifica por una ruta distinta.');
  }
  const changes = {};
  if (Object.hasOwn(body, 'nombre')) {
    if (typeof body.nombre !== 'string') throw invalid('El nombre del usuario debe ser texto.');
    const nombre = body.nombre.trim().replace(/\s+/g, ' ');
    if (nombre.length < 1 || nombre.length > 120) throw invalid('El nombre del usuario debe tener entre 1 y 120 caracteres.');
    changes.nombre = nombre;
  }
  if (Object.hasOwn(body, 'email')) {
    if (typeof body.email !== 'string') throw invalid('El email del usuario debe ser texto.');
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw invalid('El correo electrónico no tiene un formato válido.');
    changes.email = email;
  }
  let nuevaContrasena;
  if (Object.hasOwn(body, 'password')) {
    if (typeof body.password !== 'string') throw invalid('La contraseña debe ser texto.');
    if (body.password.length) {
      if (!isStrongEnoughPassword(body.password)) throw invalid('La contraseña debe tener entre 8 y 128 caracteres.');
      nuevaContrasena = body.password;
    }
  }
  if (!Object.keys(changes).length && !nuevaContrasena) throw invalid('No hay campos para actualizar.');
  return { changes, nuevaContrasena };
}

module.exports = { validarIdUsuario, limpiarNombreDepartamento, validarEdicionUsuario };
