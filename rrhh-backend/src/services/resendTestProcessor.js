'use strict';
const { configResendTest, enviarResendPrueba } = require('./resendTestTransport');

function createResendTestRepository(client = require('../config/supabase')) {
  async function rpc(nombre, args) {
    const { data, error } = await client.rpc(nombre, args);
    if (error) {
      const e = new Error('No fue posible completar una operación de la cola de pruebas.');
      e.status = 503;
      throw e;
    }
    return data;
  }
  return {
    reclamar: () => rpc('talentai_reclamar_notificaciones_resend_prueba', { p_limite: 1 }),
    obtenerDatos: async (item) => {
      const { data, error } = await client.from('notificaciones_email')
        .select('id_notificacion,id_aplicacion,tipo_evento,nombre_candidato,titulo_vacante')
        .eq('id_notificacion', item.id_notificacion)
        .single();
      if (error || !data) throw new Error('No fue posible recuperar la notificación reservada.');
      if (data.tipo_evento !== item.tipo_evento || data.id_notificacion !== item.id_notificacion) {
        throw new TypeError('Notificación inconsistente con la reserva.');
      }
      return data;
    },
    finalizar: (item, respuesta) => rpc('talentai_finalizar_notificacion_resend_prueba', {
      p_id: item.id_notificacion,
      p_token: item.lease_token,
      p_resultado: respuesta.resultado,
      p_codigo: respuesta.codigo,
      p_id_proveedor: respuesta.idMensaje,
    }),
  };
}

// Una única notificación por acción administrativa. Sin cron ni autoenvío.
async function procesarUnaPrueba({
  repo = createResendTestRepository(), enviar = enviarResendPrueba, env = process.env,
} = {}) {
  // Validar modo y permisos ANTES de reclamar trabajo en la base de datos.
  configResendTest(env);
  const filas = await repo.reclamar();
  if (!Array.isArray(filas) || filas.length > 1) throw new Error('Respuesta inválida del reclamo de pruebas.');
  const resumen = { reclamadas: filas.length, aceptadas: 0, rechazadas: 0, inciertas: 0, sin_finalizar: 0 };
  for (const item of filas) {
    let respuesta;
    try {
      // Recuperar datos reales guardados al crear el evento, sin exponerlos en logs.
      // No se envía ningún correo si el detalle no puede verificarse.
      const notificacion = await repo.obtenerDatos(item);
      respuesta = await enviar({ idNotificacion: item.id_notificacion, evento: item.tipo_evento, notificacion, env });
      if (!respuesta || !['aceptado_proveedor','fallo_transitorio','fallo_permanente','resultado_incierto'].includes(respuesta.resultado)) {
        respuesta = { resultado: 'resultado_incierto', codigo: 'RESEND_UNCERTAIN', idMensaje: null };
      }
    } catch (error) {
      respuesta = {
        resultado: error instanceof TypeError ? 'fallo_permanente' : 'resultado_incierto',
        codigo: error instanceof TypeError ? 'RENDER_ERROR' : 'RESEND_UNCERTAIN',
        idMensaje: null,
      };
    }
    try {
      const estado = await repo.finalizar(item, respuesta);
      const esperado = {
        aceptado_proveedor: 'aceptado_proveedor',
        fallo_transitorio: 'fallido',
        fallo_permanente: 'fallido',
        resultado_incierto: 'requiere_revision',
      }[respuesta.resultado];
      if (estado !== esperado) throw new Error('La finalización devolvió un estado inesperado.');
      if (respuesta.resultado === 'aceptado_proveedor') resumen.aceptadas++;
      else if (respuesta.resultado === 'resultado_incierto') resumen.inciertas++;
      else resumen.rechazadas++;
    } catch (_) {
      // Nunca volver a enviar tras una finalización incierta.
      resumen.sin_finalizar++;
    }
  }
  return resumen;
}

module.exports = { createResendTestRepository, procesarUnaPrueba };
