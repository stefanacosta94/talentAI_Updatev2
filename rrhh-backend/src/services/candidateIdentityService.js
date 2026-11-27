'use strict';

// Verificación de posesión del correo antes de vincularlo al ATS. El OTP no se
// guarda en claro y nunca se incluye en URL, respuestas, logs ni frontend.
const { randomInt, createHmac } = require('node:crypto');
const supabase = require('../config/supabase');
const { normalizeEmail, isValidEmail } = require('../security/securityUtils');
const RESEND_API_URL = 'https://api.resend.com/emails';

function httpError(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

function configVerificacion(env = process.env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const pepper = String(env.ATS_VERIFICATION_SECRET || '');
  if (!/^re_[a-z0-9_-]{6,}$/i.test(key) || pepper.length < 32) {
    throw httpError('La verificación por correo no está configurada (API y secreto de al menos 32 caracteres).');
  }
  const modoPrueba = env.ATS_VERIFICATION_TEST_MODE !== 'false';
  let remitente;
  let correoCuenta = null;
  if (modoPrueba) {
    // Resend onboarding solo puede enviar al email asociado a la cuenta.
    remitente = 'TalentAI Demo <onboarding@resend.dev>';
    correoCuenta = normalizeEmail(env.RESEND_ACCOUNT_EMAIL);
    if (!isValidEmail(correoCuenta)) throw httpError('Falta RESEND_ACCOUNT_EMAIL para el modo de pruebas.');
  } else {
    remitente = String(env.ATS_VERIFICATION_FROM || '').trim();
    // La propiedad de este dominio DEBE verificarse en el panel Resend.
    if (!/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(remitente)
      || /onboarding@resend\.dev/i.test(remitente)) {
      throw httpError('Configura ATS_VERIFICATION_FROM con un dominio verificado en Resend.');
    }
  }
  return { key, pepper, modoPrueba, correoCuenta, remitente };
}

function generarCodigo(random = randomInt) {
  return String(random(0, 1_000_000)).padStart(6, '0');
}

function codigoHash(correo, codigo, secret) {
  if (!/^\d{6}$/.test(String(codigo)) || !isValidEmail(correo) || !secret || secret.length < 32) {
    throw httpError('Código de verificación inválido.', 400);
  }
  return createHmac('sha256', secret).update(`${normalizeEmail(correo)}\u0000${codigo}`).digest('hex');
}

function mensajeCodigo(codigo) {
  const texto = `Tu código de verificación de TalentAI es: ${codigo}.\n\nCaduca en 10 minutos. Si no solicitaste este código, ignora este mensaje.`;
  return {
    subject: 'TalentAI | Verifica tu correo para postularte',
    text: texto,
    html: `<div style="font:16px Arial,sans-serif;max-width:520px;margin:auto;color:#17243b"><h2>Verifica tu correo</h2><p>Utiliza este código para completar tu postulación:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${codigo}</p><p>Válido por 10 minutos. Si no lo solicitaste, puedes ignorar este mensaje.</p></div>`,
  };
}

async function iniciarVerificacion(correo, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const email = normalizeEmail(correo);
  if (!isValidEmail(email)) throw httpError('Correo electrónico inválido.', 400);
  const cfg = configVerificacion(env);
  if (cfg.modoPrueba && email !== cfg.correoCuenta) {
    // Nunca enviar OTP a terceros utilizando el remitente de demostración.
    throw httpError('Modo pruebas: solo puede verificarse el correo asociado a tu cuenta Resend.', 503);
  }
  if (typeof fetchImpl !== 'function') throw httpError('Node.js 18 o superior es necesario.');

  const codigo = generarCodigo();
  const hash = codigoHash(email, codigo, cfg.pepper);
  const { data: permitido, error } = await supabase.rpc('ats_iniciar_verificacion_correo', {
    p_correo: email, p_codigo_hash: hash,
  });
  if (error) {
    console.error('[ATS-IDENTIDAD] No se pudo reservar el código.', { codigo: error.code });
    throw httpError('No se pudo iniciar la verificación en este momento.');
  }
  // Mismo resultado HTTP para cooldown/límite. Sin indicar existencia de candidato.
  if (permitido !== true) return { solicitada: true, envio: 'limitado' };

  const contenido = mensajeCodigo(codigo);
  let respuesta;
  try {
    respuesta = await fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `talentai-verificacion-${hash}`,
      },
      body: JSON.stringify({
        from: cfg.remitente, to: [email], ...contenido,
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    // Un timeout podría corresponder a un envío aceptado. No reenviar automáticamente.
    throw httpError('No pudimos confirmar el envío. Revisa tu correo antes de solicitar otro código.');
  }
  if (!respuesta.ok) {
    // El rechazo explícito no deja un código válido que nunca llegará.
    await supabase.rpc('ats_cancelar_verificacion_correo', {
      p_correo: email, p_codigo_hash: hash,
    }).catch(() => {});
    console.warn('[ATS-IDENTIDAD] Resend rechazó la verificación.', { status: respuesta.status });
    throw httpError('El servicio de verificación por correo no está disponible.');
  }
  return { solicitada: true, envio: 'aceptado' };
}

async function confirmarPostulacion({ correo, codigo, nombre, telefono, linkedin, idVacante, cvPath }, { env = process.env } = {}) {
  const cfg = configVerificacion(env);
  const hash = codigoHash(correo, codigo, cfg.pepper);
  const { data, error } = await supabase.rpc('ats_confirmar_postulacion_verificada', {
    p_correo: normalizeEmail(correo),
    p_codigo_hash: hash,
    p_nombre: nombre,
    p_telefono: telefono || '',
    p_linkedin: linkedin || '',
    p_id_vacante: idVacante,
    p_cv_path: cvPath,
  });
  if (error) {
    console.error('[ATS-IDENTIDAD] Error al confirmar la postulación.', { codigo: error.code });
    throw httpError('No fue posible registrar la postulación en este momento.');
  }
  return Array.isArray(data) ? data[0] : data;
}

module.exports = {
  configVerificacion, generarCodigo, codigoHash, mensajeCodigo,
  iniciarVerificacion, confirmarPostulacion,
};
