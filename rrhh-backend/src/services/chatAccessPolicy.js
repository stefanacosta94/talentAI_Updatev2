'use strict';

// Determina autorización con el estado ACTUAL de la base de datos, no el rol del JWT.
// Las cuentas creadas mediante registro público no tienen un vínculo laboral por defecto.
function decidirAccesoChat(usuarioActual, empleadoVinculado) {
  if (!usuarioActual) return { permitido: false, status: 401, error: 'La cuenta de esta sesión ya no existe.' };
  if (usuarioActual.rol === 'admin') return { permitido: true };
  if (usuarioActual.rol !== 'empleado') {
    return { permitido: false, status: 403, error: 'No tienes acceso al asistente interno.' };
  }
  if (!empleadoVinculado || empleadoVinculado.estado !== 'Activo') {
    return { permitido: false, status: 403, error: 'No tienes acceso al asistente interno.' };
  }
  return { permitido: true };
}

module.exports = { decidirAccesoChat };
