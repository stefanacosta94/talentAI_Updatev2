'use strict';

// Consumidor durable de evaluaciones IA. Requiere la migración SQL 18.
// La reserva y el cierre son RPC transaccionales; no procesar en memoria tras responder HTTP.
const supabase = require('../config/supabase');
const atsService = require('./atsService');
const { normalizeStoragePath } = require('./storageService');

function numeroEnv(valor, defecto, minimo, maximo) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= minimo && numero <= maximo ? numero : defecto;
}

function codigoFallo(error) {
  if (error?.message === 'IA_RESPUESTA_INVALIDA') return 'IA_RESPUESTA_INVALIDA';
  if (error?.message === 'IA_SERVICIO_NO_DISPONIBLE') {
    return Number(error.status) === 429 ? 'IA_CUOTA' : 'IA_INDISPONIBLE';
  }
  if (error?.message === 'CV_NO_DISPONIBLE') return 'CV_NO_DISPONIBLE';
  if (/extraer el texto/.test(error?.message || '')) return 'CV_ILEGIBLE';
  return 'EVALUACION_ERROR';
}

async function procesarUnaEvaluacion({ db = supabase, servicio = atsService } = {}) {
  const reserva = await db.rpc('ats_tomar_evaluacion');
  if (reserva.error) throw new Error('No fue posible reservar una evaluación ATS.');
  const tarea = reserva.data?.[0];
  if (!tarea) return { procesada: false };

  const id = Number(tarea.id_aplicacion);
  const token = tarea.lease_token;
  let puntaje = null;
  let resumen = null;
  let errorCodigo = null;

  try {
    const { data: aplicacion, error: errorApp } = await db.from('aplicaciones_ats')
      .select('id_aplicacion, url_archivo_cv, ai_match_score, id_vacante')
      .eq('id_aplicacion', id).maybeSingle();
    if (errorApp || !aplicacion) throw new Error('CV_NO_DISPONIBLE');
    if (aplicacion.ai_match_score !== null && aplicacion.ai_match_score !== undefined) {
      // Evaluada por otra vía: cerrar tarea sin volver a llamar a Gemini.
      puntaje = aplicacion.ai_match_score;
      resumen = 'Evaluación existente conservada.';
    } else {
      const { data: vacante, error: errorVacante } = await db.from('vacantes')
        .select('titulo, descripcion_puesto, requisitos')
        .eq('id_vacante', aplicacion.id_vacante).maybeSingle();
      if (errorVacante || !vacante) throw new Error('CV_NO_DISPONIBLE');
      const path = normalizeStoragePath(aplicacion.url_archivo_cv, 'curriculums');
      if (!path) throw new Error('CV_NO_DISPONIBLE');
      const { data: archivo, error: errorArchivo } = await db.storage.from('curriculums').download(path);
      if (errorArchivo || !archivo) throw new Error('CV_NO_DISPONIBLE');
      const buffer = Buffer.from(await archivo.arrayBuffer());
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('CV_NO_DISPONIBLE');
      const texto = await servicio.extraerTextoPDF(buffer);
      const descripcion = `Puesto: ${vacante.titulo}. Descripción: ${vacante.descripcion_puesto}. Requisitos: ${vacante.requisitos}`;
      const evaluacion = await servicio.evaluarCandidato(texto, descripcion);
      // Validar aunque el servicio haya sido sustituido en pruebas o evolución futura.
      const valido = atsService.validarEvaluacionIA(evaluacion);
      puntaje = valido.ai_match_score;
      resumen = valido.ai_resumen_habilidades;
    }
  } catch (error) {
    errorCodigo = codigoFallo(error);
  }

  const cierre = await db.rpc('ats_finalizar_evaluacion', {
    p_id_aplicacion: id,
    p_lease_token: token,
    p_puntaje: puntaje,
    p_resumen: resumen,
    p_error_codigo: errorCodigo,
  });
  if (cierre.error) throw new Error('No fue posible confirmar la evaluación ATS.');
  console.info('[ATS-EVAL]', { id_aplicacion: id, resultado: errorCodigo || 'completada', vigente: cierre.data === true });
  return { procesada: true, id_aplicacion: id, resultado: errorCodigo || 'completada', vigente: cierre.data === true };
}

function iniciarEvaluadorAtsAutomatico({ ejecutar = procesarUnaEvaluacion } = {}) {
  if (process.env.ATS_ASYNC_EVALUATION_ENABLED !== 'true') {
    console.info('[ATS-EVAL] Desactivado (requiere migración SQL 18).');
    return null;
  }
  const intervaloMs = numeroEnv(process.env.ATS_EVALUATION_POLL_MS, 15000, 5000, 60000);
  let ejecutando = false;
  const tick = async () => {
    if (ejecutando) return;
    ejecutando = true;
    try { await ejecutar(); }
    catch (_) { console.warn('[ATS-EVAL] Error en el ciclo de evaluación; se reintentará.'); }
    finally { ejecutando = false; }
  };
  const inicio = setTimeout(tick, 1500);
  inicio.unref?.();
  const timer = setInterval(tick, intervaloMs);
  timer.unref?.();
  console.info('[ATS-EVAL] Trabajador activo', { intervaloMs });
  return { tick, detener() { clearTimeout(inicio); clearInterval(timer); } };
}

module.exports = { numeroEnv, codigoFallo, procesarUnaEvaluacion, iniciarEvaluadorAtsAutomatico };
