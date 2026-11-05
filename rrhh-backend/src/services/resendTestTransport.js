'use strict';

// Fase 5D: envío EXCLUSIVAMENTE a un destinatario de pruebas autorizado.
// No es un transporte de producción. Sin SDK: usa fetch nativo Node.js >= 18.
const { renderEmail } = require('./mailTemplates');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_URL = 'https://api.resend.com/emails';
const DESTINATARIOS_RESEND = new Set(['delivered@resend.dev', 'bounced@resend.dev', 'complained@resend.dev']);

function configResendTest(env = process.env) {
  if (String(env.EMAIL_MODE || 'mock').trim() !== 'resend_test' || String(env.RESEND_TEST_ENABLED || '') !== 'true') {
    throw Object.assign(new Error('El envío Resend de pruebas no está habilitado.'), { status: 409 });
  }
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  if (!/^re_[a-z0-9_-]{6,}$/i.test(apiKey)) {
    throw Object.assign(new Error('Configura RESEND_API_KEY en el backend.'), { status: 503 });
  }
  const destino = String(env.RESEND_TEST_TO || '').trim().toLowerCase();
  const cuenta = String(env.RESEND_ACCOUNT_EMAIL || '').trim().toLowerCase();
  if (!EMAIL.test(destino) || destino.includes(',') || destino.includes(';')) {
    throw Object.assign(new Error('RESEND_TEST_TO debe ser una única dirección de pruebas.'), { status: 503 });
  }
  if (!DESTINATARIOS_RESEND.has(destino) && (!EMAIL.test(cuenta) || destino !== cuenta)) {
    throw Object.assign(new Error('RESEND_TEST_TO debe ser una dirección de prueba oficial o el correo de tu cuenta Resend.'), { status: 503 });
  }
  if (typeof globalThis.fetch !== 'function') {
    throw Object.assign(new Error('Necesitas Node.js 18 o superior para usar Resend.'), { status: 503 });
  }
  return Object.freeze({ apiKey, destino, remitente: 'TalentAI Demo <onboarding@resend.dev>' });
}

// Esta función no incluye datos del candidato real en el payload ni en errores/logs.
function prepararMensajePrueba(idNotificacion, evento, config) {
  if (!UUID.test(String(idNotificacion))) throw new TypeError('ID de notificación inválido.');
  const correo = renderEmail({
    evento,
    nombreCandidato: 'Candidato de demostración',
    tituloVacante: 'Vacante de demostración',
    empresa: 'TalentAI Demo',
  });
  const banner = '<p style="padding:12px;background:#ffedd5;color:#9a3412;text-align:center;font-weight:bold">PRUEBA TÉCNICA — NO ES UNA COMUNICACIÓN REAL A UN CANDIDATO</p>';
  return {
    idempotencyKey: `talentai-5d-prueba-${idNotificacion}`,
    payload: {
      from: config.remitente,
      to: [config.destino],
      subject: `[PRUEBA TalentAI] ${correo.asunto}`,
      html: correo.html.replace('<body ', `<body `).replace(/(<body[^>]*>)/i, `$1${banner}`),
      text: `PRUEBA TÉCNICA. No es una comunicación real a un candidato.\n\n${correo.texto}`,
    },
  };
}

// Los errores ambiguos pasan a revisión manual: un timeout/5xx puede haber sido aceptado.
// Resend conserva idempotencia 24 h; fuera de esa ventana nunca reintentar a ciegas.
async function enviarResendPrueba({ idNotificacion, evento, fetchImpl = globalThis.fetch, env = process.env }) {
  const cfg = configResendTest(env);
  const { payload, idempotencyKey } = prepararMensajePrueba(idNotificacion, evento, cfg);
  let response;
  try {
    response = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (_) {
    return { resultado: 'resultado_incierto', codigo: 'RESEND_UNCERTAIN', idMensaje: null };
  }
  if (response.ok) {
    try {
      const data = await response.json();
      if (typeof data.id === 'string' && UUID.test(data.id)) {
        return { resultado: 'aceptado_proveedor', codigo: 'RESEND_ACCEPTED', idMensaje: data.id };
      }
    } catch (_) { /* resultado de proveedor no verificable */ }
    return { resultado: 'resultado_incierto', codigo: 'RESEND_UNCERTAIN', idMensaje: null };
  }
  // 429 = rechazo explícito por cuota/velocidad; no implica aceptación previa.
  if (response.status === 429) {
    return { resultado: 'fallo_transitorio', codigo: 'RESEND_RATE_LIMIT', idMensaje: null };
  }
  // Error 409 puede indicar solicitud idempotente concurrente/ya procesada.
  if (response.status === 409 || response.status >= 500 || response.status === 408) {
    return { resultado: 'resultado_incierto', codigo: 'RESEND_UNCERTAIN', idMensaje: null };
  }
  // Rechazo explícito de autenticación, remitente o validación: requiere corrección.
  return { resultado: 'fallo_permanente', codigo: 'RESEND_REJECTED', idMensaje: null };
}

module.exports = { configResendTest, prepararMensajePrueba, enviarResendPrueba };
