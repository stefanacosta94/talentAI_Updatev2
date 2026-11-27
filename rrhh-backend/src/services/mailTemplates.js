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

// Mensajes contextualizados por etapa. No se inventan fechas de entrevistas ni ofertas formales.
const SIGUIENTE_PASO = Object.freeze({
  postulacion_recibida: 'Por ahora no necesitas realizar ninguna acción. Nuestro equipo revisará la documentación recibida.',
  en_revision: 'No necesitas enviar nuevamente tu currículum. Te contactaremos si requerimos información adicional.',
  entrevista: 'Nuestro equipo se comunicará para coordinar fecha, modalidad y lugar. No hay una cita agendada mediante este correo.',
  contratado: 'Espera el contacto formal del equipo de Recursos Humanos para conocer las condiciones y los siguientes pasos.',
  descartado: 'No necesitas realizar ninguna acción adicional. Agradecemos tu participación en el proceso.',
});

function renderEmail({ evento, nombreCandidato, tituloVacante, empresa = 'Equipo de selección', idAplicacion = null }) {
  if (!Object.hasOwn(EVENTOS, evento)) throw new TypeError('Evento de notificación no permitido.');
  const nombre = String(nombreCandidato || '').trim();
  const vacante = String(tituloVacante || '').trim();
  const marca = String(empresa || '').trim();
  if (!nombre || !vacante || !marca) throw new TypeError('Faltan datos de la notificación.');
  if ([nombre, vacante, marca].some(v => v.length > 180)) throw new TypeError('Datos de notificación demasiado largos.');
  const referencia = Number.isSafeInteger(idAplicacion) && idAplicacion > 0
    ? `TA-${String(idAplicacion).padStart(6, '0')}` : null;
  const saludo = `Hola, ${nombre}:`;
  const mensaje = MENSAJES[evento];
  const siguiente = SIGUIENTE_PASO[evento];
  const etapa = EVENTOS[evento].etiqueta;
  const asunto = `${EVENTOS[evento].asunto} | ${marca}`;
  const nota = 'Comunicación automática del proceso de selección. No respondas directamente a este mensaje.';
  const texto = `${saludo}\n\n${mensaje}\n\nVacante: ${vacante}\nEstado: ${etapa}${referencia ? `\nReferencia: ${referencia}` : ''}\n\nSiguiente paso: ${siguiente}\n\n${nota}\n\n${marca}`;
  const filaReferencia = referencia
    ? `<tr><td style="padding:7px 0;font-size:12px;color:#64748b">Referencia</td><td align="right" style="padding:7px 0;font-size:13px;font-weight:700;color:#0f172a">${escapeHtml(referencia)}</td></tr>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#edf2f9;font-family:Arial,Helvetica,sans-serif;color:#152747;padding:32px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe7f3">
<tr><td style="padding:27px 32px;background:#102857;color:#ffffff"><div style="font-size:24px;font-weight:800;letter-spacing:-.4px">Talent<span style="color:#8bb9ff">AI</span></div><div style="font-size:11px;color:#cbdcf8;margin-top:6px">Gestión de selección y talento</div></td></tr>
<tr><td style="padding:32px">
<p style="font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:#2563eb;font-weight:800;margin:0 0 16px">${escapeHtml(etapa)}</p>
<h1 style="font-size:23px;line-height:1.3;color:#142857;margin:0 0 18px">${escapeHtml(saludo)}</h1>
<p style="font-size:15px;color:#334155;line-height:1.75;margin:0 0 24px">${escapeHtml(mensaje)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f8ff;border:1px solid #dfebff;border-radius:12px;padding:18px;margin:0 0 24px">
<tr><td colspan="2" style="padding:0 0 10px;font-size:11px;letter-spacing:1px;color:#64748b;font-weight:800">DETALLES DE TU CANDIDATURA</td></tr>
<tr><td style="padding:7px 0;color:#64748b;font-size:12px">Vacante</td><td align="right" style="padding:7px 0;color:#142857;font-size:13px;font-weight:700">${escapeHtml(vacante)}</td></tr>
<tr><td style="padding:7px 0;color:#64748b;font-size:12px">Estado</td><td align="right" style="padding:7px 0;color:#1d4ed8;font-size:13px;font-weight:700">${escapeHtml(etapa)}</td></tr>
${filaReferencia}</table>
<div style="border-left:3px solid #3b82f6;padding:12px 16px;background:#f8fafc;border-radius:0 8px 8px 0"><strong style="font-size:12px;color:#1e40af">¿Qué sigue?</strong><p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:#475569">${escapeHtml(siguiente)}</p></div>
<p style="font-size:12px;color:#64748b;line-height:1.6;margin:26px 0 0">${escapeHtml(nota)}</p>
</td></tr>
<tr><td style="padding:21px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">${escapeHtml(marca)} · Actualizaciones de tu candidatura</td></tr>
</table></body></html>`;
  return { asunto, texto, html };
}

module.exports = { EVENTOS, MENSAJES, escapeHtml, renderEmail };
