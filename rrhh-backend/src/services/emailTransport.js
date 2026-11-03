'use strict';

// Fase 5A solo admite simulación. Nunca llama a un SMTP ni a servicios externos.
// En Fase 5C se sustituirá el transportista conservando la misma interfaz.
async function enviarCorreo({ para, asunto, html, texto }) {
  const modo = String(process.env.EMAIL_MODE || 'mock').toLowerCase();
  if (modo !== 'mock') {
    throw new Error('Modo de correo no configurado: en Fase 5A únicamente se permite EMAIL_MODE=mock.');
  }
  if (!para || !asunto || !html || !texto) throw new TypeError('Correo incompleto.');
  // Intencionalmente no escribimos el email, el asunto ni el contenido en logs.
  return Object.freeze({ simulado: true, aceptadoPorProveedor: false, idMensaje: null });
}

module.exports = { enviarCorreo };
