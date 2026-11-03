'use strict';

// Plantillas transaccionales sin I/O. El contenido aportado por el candidato se escapa.
const EVENTOS = Object.freeze({
  postulacion_recibida: { etiqueta: 'Postulación recibida', asunto: 'Recibimos tu postulación' },
  en_revision: { etiqueta: 'En revisión', asunto: 'Actualización de tu postulación' },
  entrevista: { etiqueta: 'Entrevista', asunto: 'Tu proceso de selección avanza' },
  contratado: { etiqueta: 'Contratado', asunto: 'Actualización importante de tu proceso' },
  descartado: { etiqueta: 'Proceso finalizado', asunto: 'Información sobre tu postulación' },
});

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MENSAJES = Object.freeze({
  postulacion_recibida: 'Hemos recibido tu postulación. Nuestro equipo revisará la información que compartiste.',
  en_revision: 'Tu postulación se encuentra en revisión por el equipo de selección. Te avisaremos si hay novedades.',
  entrevista: 'Has avanzado a la etapa de entrevista. Nuestro equipo te contactará para coordinar los detalles. Este mensaje no confirma una fecha ni una hora.',
  contratado: 'El equipo de selección ha registrado una decisión favorable. Nos pondremos en contacto contigo para confirmar formalmente los siguientes pasos.',
  descartado: 'Agradecemos tu interés y el tiempo dedicado. En esta ocasión, tu proceso de selección ha finalizado. Te deseamos éxito en tus próximas oportunidades.',
});

function renderEmail({ evento, nombreCandidato, tituloVacante, empresa = 'Equipo de selección' }) {
  if (!Object.hasOwn(EVENTOS, evento)) throw new TypeError('Evento de notificación no permitido.');
  const nombre = String(nombreCandidato || '').trim();
  const vacante = String(tituloVacante || '').trim();
  const marca = String(empresa || '').trim();
  if (!nombre || !vacante || !marca) throw new TypeError('Faltan datos de la notificación.');
  if ([nombre, vacante, marca].some(v => v.length > 180)) throw new TypeError('Datos de notificación demasiado largos.');
  const saludo = `Hola, ${nombre}:`;
  const mensaje = MENSAJES[evento];
  const asunto = `${EVENTOS[evento].asunto} | ${marca}`;
  const nota = 'Este es un mensaje informativo del proceso de selección. No respondas a este correo automático.';
  const texto = `${saludo}\n\n${mensaje}\n\nVacante: ${vacante}\n\n${nota}\n\n${marca}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;padding:28px 12px">
<table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#102857;padding:26px;color:white;font-size:22px;font-weight:bold">Talent<span style="color:#93c5fd">AI</span></td></tr>
<tr><td style="padding:30px"><p style="font-size:14px;color:#2563eb;font-weight:bold">${escapeHtml(EVENTOS[evento].etiqueta)}</p>
<h1 style="font-size:22px;margin:10px 0">${escapeHtml(saludo)}</h1>
<p style="font-size:15px;line-height:1.65;color:#334155">${escapeHtml(mensaje)}</p>
<div style="background:#f8fafc;border-left:4px solid #2563eb;padding:15px;margin:24px 0;border-radius:6px"><strong>Vacante</strong><p style="margin:7px 0 0">${escapeHtml(vacante)}</p></div>
<p style="font-size:12px;color:#64748b;line-height:1.6">${escapeHtml(nota)}</p></td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">${escapeHtml(marca)} · Comunicación transaccional de selección</td></tr>
</table></body></html>`;
  return { asunto, texto, html };
}

module.exports = { EVENTOS, MENSAJES, escapeHtml, renderEmail };
