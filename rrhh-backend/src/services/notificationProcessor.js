'use strict';

const { renderEmail } = require('./mailTemplates');
const { enviarCorreo } = require('./emailTransport');

function assertMockMode() {
  if (String(process.env.EMAIL_MODE || 'mock').toLowerCase() !== 'mock') {
    throw Object.assign(new Error('La Fase 5C solo admite EMAIL_MODE=mock; no se ejecutó ningún despacho.'), { status: 409 });
  }
}

function safeCount(valor, max = 20) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw Object.assign(new TypeError(`Cantidad permitida: entre 1 y ${max}.`), { status: 400 });
  }
  return n;
}

function createQueueRepository(client = require('../config/supabase')) {
  async function rpc(nombre, args) {
    const { data, error } = await client.rpc(nombre, args);
    if (error) {
      // Nunca incluir en errores HTTP el texto bruto del proveedor o datos personales.
      const e = new Error('No fue posible completar la operación en la cola.');
      e.status = 503;
      e.code = error.code;
      throw e;
    }
    return data;
  }
  return {
    reclamar: (limite) => rpc('talentai_reclamar_notificaciones_mock', { p_limite: limite }),
    finalizar: (id, token, resultado, codigo) => rpc('talentai_finalizar_notificacion_mock', {
      p_id: id, p_token: token, p_resultado: resultado, p_codigo: codigo,
    }),
  };
}

// Procesamiento manual o invocado por un worker explícito. NO hay cron oculto.
// MOCK: nunca se informa 'enviado' ni se incrementan intentos reales en éxito.
async function procesarLote({ limite = 10, repo = createQueueRepository(), render = renderEmail, enviar = enviarCorreo } = {}) {
  assertMockMode();
  const n = safeCount(limite);
  const reclamadas = await repo.reclamar(n);
  if (!Array.isArray(reclamadas)) throw new Error('Respuesta inesperada al reclamar la cola.');
  const resumen = { reclamadas: reclamadas.length, simuladas: 0, fallidas: 0, sin_finalizar: 0 };
  for (const item of reclamadas) {
    let resultado = 'simulado';
    let codigo = 'MOCK_OK';
    try {
      const correo = render({
        evento: item.tipo_evento,
        nombreCandidato: item.nombre_candidato,
        tituloVacante: item.titulo_vacante,
      });
      const respuesta = await enviar({
        para: item.destinatario_email, asunto: correo.asunto,
        html: correo.html, texto: correo.texto,
      });
      // Un transporte no simulado es un error y NO debe confirmar el registro.
      if (!respuesta || respuesta.simulado !== true || respuesta.aceptadoPorProveedor !== false) {
        throw new Error('El transporte no respondió como simulación.');
      }
    } catch (error) {
      resultado = 'fallo_transitorio';
      codigo = error instanceof TypeError ? 'TEMPLATE_ERROR' : 'TRANSPORT_UNAVAILABLE';
    }
    try {
      await repo.finalizar(item.id_notificacion, item.lease_token, resultado, codigo);
      if (resultado === 'simulado') resumen.simuladas++;
      else resumen.fallidas++;
    } catch (_) {
      // Revisión manual tras caducidad; nunca reintentar sin un nuevo lease.
      resumen.sin_finalizar++;
    }
  }
  return resumen;
}

module.exports = { assertMockMode, safeCount, createQueueRepository, procesarLote };
