'use strict';

// Fase 8B: las firmas Svix de Resend se verifican sobre bytes SIN reserializar.
// No almacena asunto, correo, destinatario, cuerpo ni datos personales del webhook.
const crypto = require('node:crypto');

const TIPOS = Object.freeze(new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
  'email.complained', 'email.failed', 'email.suppressed',
]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_EVENTO = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_FIRMA_EDAD_SEG = 300;

class WebhookError extends Error {
  constructor(codigo, status = 400) {
    super('Solicitud de webhook no válida.');
    this.code = codigo;
    this.status = status;
  }
}

function configuracionWebhook(env = process.env) {
  if (env.RESEND_WEBHOOKS_ENABLED !== 'true') throw new WebhookError('DISABLED', 503);
  const secret = String(env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret.startsWith('whsec_')) throw new WebhookError('SECRET_INVALID', 503);
  const data = secret.slice(6);
  if (!/^[a-zA-Z0-9+/=_-]+$/.test(data)) throw new WebhookError('SECRET_INVALID', 503);
  const key = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length < 16 || key.length > 128) throw new WebhookError('SECRET_INVALID', 503);
  return { key };
}

function verificarFirmaWebhook({ body, headers, env = process.env, ahoraMs = Date.now() }) {
  const { key } = configuracionWebhook(env);
  if (!Buffer.isBuffer(body) || body.length < 2 || body.length > 65536) {
    throw new WebhookError('BODY_INVALID');
  }
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signature = headers['svix-signature'];
  if (typeof id !== 'string' || !ID_EVENTO.test(id) ||
      typeof timestamp !== 'string' || !/^\d{10,11}$/.test(timestamp) ||
      typeof signature !== 'string' || signature.length > 2048) {
    throw new WebhookError('HEADERS_INVALID');
  }
  const t = Number(timestamp);
  if (!Number.isSafeInteger(t) || Math.abs(Math.floor(ahoraMs / 1000) - t) > MAX_FIRMA_EDAD_SEG) {
    throw new WebhookError('TIMESTAMP_INVALID');
  }
  const esperado = crypto.createHmac('sha256', key)
    .update(`${id}.${timestamp}.`, 'utf8').update(body).digest();
  // Svix puede enviar varias firmas v1 durante una rotación de secreto.
  const valido = signature.split(/\s+/).some((item) => {
    const match = /^v1,([a-zA-Z0-9+/=]+)$/.exec(item);
    if (!match) return false;
    const recibido = Buffer.from(match[1], 'base64');
    return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
  });
  if (!valido) throw new WebhookError('SIGNATURE_INVALID');
  return id;
}

function extraerEventoSeguro(body, idEvento) {
  let obj;
  try { obj = JSON.parse(body.toString('utf8')); }
  catch (_) { throw new WebhookError('JSON_INVALID'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      typeof obj.type !== 'string') throw new WebhookError('EVENT_INVALID');
  if (!TIPOS.has(obj.type)) return null; // otros eventos no se consumen
  const emailId = obj.data?.email_id;
  const fecha = obj.created_at;
  if (typeof emailId !== 'string' || !UUID.test(emailId) ||
      typeof fecha !== 'string' || !Number.isFinite(Date.parse(fecha))) {
    throw new WebhookError('EVENT_FIELDS_INVALID');
  }
  // Se usa únicamente metadata estrictamente tipada, sin PII ni payload sin filtrar.
  return { idEvento, idMensaje: emailId, tipo: obj.type, ocurridoEn: new Date(fecha).toISOString() };
}

function crearRepositorioWebhook(db = require('../config/supabase')) {
  return {
    async registrar(e) {
      const { data, error } = await db.rpc('talentai_registrar_webhook_resend', {
        p_evento_id: e.idEvento,
        p_id_mensaje: e.idMensaje,
        p_tipo: e.tipo,
        p_ocurrido_en: e.ocurridoEn,
      });
      if (error || !['aplicado','pendiente','duplicado'].includes(data)) {
        throw new WebhookError('PERSISTENCE_ERROR', 503);
      }
      return data;
    },
  };
}

async function procesarWebhookFirmado({ body, headers, env = process.env,
  repo = crearRepositorioWebhook(), ahoraMs = Date.now() }) {
  const idEvento = verificarFirmaWebhook({ body, headers, env, ahoraMs });
  const evento = extraerEventoSeguro(body, idEvento);
  if (!evento) return { resultado: 'ignorado' };
  const resultado = await repo.registrar(evento);
  return { resultado };
}

module.exports = {
  WebhookError, TIPOS, configuracionWebhook, verificarFirmaWebhook,
  extraerEventoSeguro, crearRepositorioWebhook, procesarWebhookFirmado,
};
