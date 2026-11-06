'use strict';

// Gemini Embedding API por HTTPS: no requiere SDK adicional.
// Solo se utiliza desde Express/CLI; nunca se envía la API Key al navegador.
const { httpStatus, isTransient } = require('./geminiRetry');

const DIMENSIONES = 1536;
const MODELO_DEFAULT = 'gemini-embedding-001';
const MAX_TEXTO = 2200;

function modeloEmbedding() {
  const name = String(process.env.GEMINI_EMBEDDING_MODEL || MODELO_DEFAULT).trim();
  // No usar gemini-embedding-2 con vectores de embedding-001: son espacios incompatibles.
  if (name !== MODELO_DEFAULT) throw new Error('Este índice RAG requiere gemini-embedding-001.');
  return name;
}

function toEmbeddingError(status, message = '') {
  const err = new Error(status === 429
    ? 'Se alcanzó un límite de la API de embeddings. Reintenta más tarde.'
    : (status >= 500 ? 'Gemini Embeddings está temporalmente indisponible.'
      : 'No se pudo generar el vector semántico. Verifica la configuración del servicio.'));
  err.status = [408, 429, 500, 502, 503, 504].includes(status) ? 503 : 502;
  err.code = status === 429 ? 'EMBEDDING_QUOTA' : 'EMBEDDING_SERVICE_ERROR';
  err.isGeminiServiceError = true;
  err.retryable = isTransient({ status, message });
  return err;
}

// Para dimensión reducida, Google recomienda normalizar embedding-001.
function normalizarVector(values) {
  if (!Array.isArray(values) || values.length !== DIMENSIONES || !values.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('La API de embeddings devolvió dimensiones o valores no válidos.');
  }
  const norma = Math.hypot(...values);
  if (!Number.isFinite(norma) || norma <= 0) throw new Error('Embedding sin magnitud válida.');
  return values.map(v => v / norma);
}

async function generarEmbedding(texto, { tipo = 'RETRIEVAL_QUERY', title = '', fetchFn = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const entrada = String(texto || '').trim();
  if (!entrada || entrada.length > MAX_TEXTO) throw new Error('Entrada de embedding vacía o demasiado extensa.');
  if (!['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT'].includes(tipo)) throw new Error('Tipo de embedding inválido.');
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY no está configurada.');
  const modelo = modeloEmbedding();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: `models/${modelo}`,
        content: { parts: [{ text: entrada }] },
        taskType: tipo,
        outputDimensionality: DIMENSIONES,
        ...(tipo === 'RETRIEVAL_DOCUMENT' && title ? { title: String(title).slice(0, 180) } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // No registrar respuesta cruda: podría incluir metadata sensible.
      throw toEmbeddingError(response.status, response.statusText);
    }
    const json = await response.json();
    return normalizarVector(json?.embedding?.values);
  } catch (error) {
    if (error.isGeminiServiceError) throw error;
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw toEmbeddingError(503, 'network timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { DIMENSIONES, MODELO_DEFAULT, MAX_TEXTO, modeloEmbedding, normalizarVector, generarEmbedding, toEmbeddingError };
