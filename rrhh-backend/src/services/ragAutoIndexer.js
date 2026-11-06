'use strict';

// Trabajador de indexación. El SQL 15 reserva documentos con SKIP LOCKED y lease.
// No habilitar en servidores sin la migración: RAG_AUTO_INDEX_ENABLED=true es opt-in.
const supabase = require('../config/supabase');
const { indexarDocumento, obtenerExistentes } = require('../../scripts/indexar-rag');
const { fragmentarTexto, fingerprint, versionDeterministica } = require('./ragChunks');
const { modeloEmbedding } = require('./ragEmbeddingService');

function enteroSeguro(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
function codigoSeguro(error) {
  const codigo = String(error?.code || '').toUpperCase();
  if (codigo === 'EMBEDDING_QUOTA') return codigo;
  if (codigo === 'EMBEDDING_SERVICE_ERROR') return codigo;
  if (codigo === 'DOC_EXCESIVO' || codigo === 'SIN_TEXTO') return codigo;
  return 'INDEXACION_ERROR';
}
function siguienteEstado(error, fallosPrevios) {
  const codigo = codigoSeguro(error);
  if (['SIN_TEXTO', 'DOC_EXCESIVO'].includes(codigo) || fallosPrevios >= 2) {
    return { estado: 'pausado', codigo, espera: 0 };
  }
  const base = codigo === 'EMBEDDING_QUOTA' ? 3600 : 300;
  return { estado: 'error', codigo, espera: Math.min(21600, base * (2 ** fallosPrevios)) };
}

async function procesarLote({ db = supabase, indexar = indexarDocumento, existentes = obtenerExistentes,
  porCiclo = enteroSeguro(process.env.RAG_INDEX_CHUNKS_PER_CYCLE, 3, 1, 10) } = {}) {
  const claim = await db.rpc('rag_tomar_tarea');
  if (claim.error) throw new Error(`No fue posible reservar tarea RAG: ${claim.error.code || 'RPC'}`);
  const tarea = claim.data?.[0];
  if (!tarea) return { procesado: false };
  const id = Number(tarea.id_documento);
  const token = tarea.lease_token;
  let total = 0, guardados = 0;
  const finalizar = async (estado, codigo = null, espera = 90) => {
    const respuesta = await db.rpc('rag_finalizar_lote', {
      p_id_documento: id, p_lease_token: token, p_estado: estado,
      p_total: total, p_guardados: guardados, p_error_codigo: codigo,
      p_espera_segundos: espera,
    });
    if (respuesta.error) throw new Error(`Falló el cierre de lote RAG: ${respuesta.error.code || 'RPC'}`);
    // false = documento modificado mientras se indexaba; no actualizar la tarea nueva.
    return respuesta.data === true;
  };
  try {
    const { data: doc, error: docError } = await db.from('base_conocimiento')
      .select('id_documento,contenido_texto').eq('id_documento', id).maybeSingle();
    if (docError) throw Object.assign(new Error('Lectura de documento no disponible'), { code: 'INDEXACION_ERROR' });
    if (!doc) return { procesado: true, id, vigente: false };
    const texto = doc.contenido_texto || '';
    let fragments;
    try { fragments = fragmentarTexto(texto); }
    catch (_) { throw Object.assign(new Error('Documento excede el límite del índice'), { code: 'DOC_EXCESIVO' }); }
    total = fragments.length;
    if (!total) throw Object.assign(new Error('Documento sin texto extraíble'), { code: 'SIN_TEXTO' });
    const version = versionDeterministica(id, fingerprint(texto), modeloEmbedding());
    const budget = { used: 0 };
    const resultado = await indexar(doc, { dryRun: false, maxChunks: porCiclo }, budget);
    guardados = resultado.done ? total : (await existentes(id, version)).size;
    const estado = resultado.done ? 'completado' : 'parcial';
    const vigente = await finalizar(estado, null, estado === 'parcial' ? 90 : 0);
    console.info('[RAG-AUTO] Lote', { id_documento: id, estado, fragmentos_guardados: guardados,
      fragmentos_total: total, nuevos: budget.used, vigente });
    return { procesado: true, id, estado, guardados, total, vigente };
  } catch (error) {
    const { data: metadata } = await db.from('rag_tareas_indexacion')
      .select('errores_consecutivos').eq('id_documento', id).maybeSingle();
    const fallosPrevios = enteroSeguro(metadata?.errores_consecutivos, 0, 0, 100);
    const incidente = siguienteEstado(error, fallosPrevios);
    // Recuperar avance desde PostgreSQL, incluso si la llamada a Gemini falló a mitad de lote.
    try {
      const { data: doc } = await db.from('base_conocimiento')
        .select('id_documento,contenido_texto').eq('id_documento', id).maybeSingle();
      if (doc?.contenido_texto) {
        const fragments = fragmentarTexto(doc.contenido_texto);
        total = fragments.length;
        const version = versionDeterministica(id, fingerprint(doc.contenido_texto), modeloEmbedding());
        guardados = (await existentes(id, version)).size;
      }
    } catch (_) { /* No incluir contenido ni errores crudos en logs. */ }
    let vigente = false;
    try { vigente = await finalizar(incidente.estado, incidente.codigo, incidente.espera); }
    catch (_) { console.warn('[RAG-AUTO] No fue posible guardar el diagnóstico', { id_documento: id }); }
    console.warn('[RAG-AUTO] Lote interrumpido', { id_documento: id, codigo: incidente.codigo,
      estado: incidente.estado, vigente });
    return { procesado: true, id, estado: incidente.estado, codigo: incidente.codigo, vigente };
  }
}

function iniciarIndexadorAutomatico({ ejecutar = procesarLote } = {}) {
  if (process.env.RAG_AUTO_INDEX_ENABLED !== 'true') {
    console.info('[RAG-AUTO] Desactivado (habilitar tras aplicar SQL 15).');
    return null;
  }
  const intervalo = enteroSeguro(process.env.RAG_INDEX_POLL_MS, 60000, 30000, 3600000);
  let ejecutando = false;
  let pausaCuotaHasta = 0;
  const tick = async () => {
    if (ejecutando || Date.now() < pausaCuotaHasta) return;
    ejecutando = true;
    try {
      const resultado = await ejecutar();
      if (resultado?.codigo === 'EMBEDDING_QUOTA') {
        pausaCuotaHasta = Date.now() + 60 * 60 * 1000;
        console.warn('[RAG-AUTO] En pausa una hora por cuota de embeddings');
      }
    }
    catch (error) { console.warn('[RAG-AUTO] No se pudo ejecutar ciclo', { codigo: codigoSeguro(error) }); }
    finally { ejecutando = false; }
  };
  const inicio = setTimeout(tick, 3000);
  inicio.unref?.();
  const timer = setInterval(tick, intervalo);
  timer.unref?.();
  console.info('[RAG-AUTO] Trabajador habilitado', { intervaloMs: intervalo,
    fragmentosPorCiclo: enteroSeguro(process.env.RAG_INDEX_CHUNKS_PER_CYCLE, 3, 1, 10) });
  return { detener() { clearInterval(timer); clearTimeout(inicio); }, tick };
}

module.exports = { enteroSeguro, codigoSeguro, siguienteEstado, procesarLote, iniciarIndexadorAutomatico };
