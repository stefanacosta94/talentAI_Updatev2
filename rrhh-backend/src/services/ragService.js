'use strict';

// El modelo compartido por ATS y otros módulos se mantiene sin cambios.
// GEMINI_RAG_MODEL permite aislar exclusivamente las consultas documentales.
const modeloGemini = require('../config/gemini');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { withGeminiRetry, isTransient, httpStatus, attemptsFromEnv } = require('./geminiRetry');

const modelsByName = new Map();

function primaryModelName() {
  return String(process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim() || 'gemini-3.6-flash';
}

function ragModelName() {
  return String(process.env.GEMINI_RAG_MODEL || '').trim() || primaryModelName();
}

function modelForName(name) {
  if (name === primaryModelName()) return modeloGemini;
  if (!modelsByName.has(name)) {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    modelsByName.set(name, client.getGenerativeModel({ model: name }));
  }
  return modelsByName.get(name);
}

function getFallbackModel() {
  const name = String(process.env.GEMINI_FALLBACK_MODEL || '').trim();
  if (!name || name === ragModelName()) return null;
  return { name, model: modelForName(name) };
}

// Solo estadísticas técnicas numéricas; jamás registrar preguntas, prompts,
// documentos, respuestas, direcciones de usuario ni claves.
function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function geminiUsage(result) {
  const usage = result?.response?.usageMetadata;
  return {
    tokensEntrada: safeTokenCount(usage?.promptTokenCount),
    tokensSalida: safeTokenCount(usage?.candidatesTokenCount),
    tokensTotales: safeTokenCount(usage?.totalTokenCount),
  };
}

function reportSuccess({ model, startedAt, attempts, fallback, result }) {
  if (typeof console.info === 'function') {
    console.info('[RAG] Gemini completado', {
      modelo: model,
      latenciaMs: Math.max(0, Date.now() - startedAt),
      solicitudesAlModelo: attempts,
      respaldo: fallback,
      ...geminiUsage(result),
    });
  }
}

function toPublicGeminiError(error) {
  const status = httpStatus(error);
  const transient = isTransient(error);
  const quota = status === 429 && !transient;
  const publicError = new Error(quota
    ? 'El servicio de IA alcanzó su cuota disponible. Intenta más tarde.'
    : transient
      ? 'El servicio de IA está temporalmente ocupado. Intenta nuevamente en unos segundos.'
      : 'No se pudo completar la consulta al servicio de IA. Contacta al administrador si persiste.');
  publicError.status = transient || quota ? 503 : 502;
  publicError.code = quota ? 'GEMINI_QUOTA' : (transient ? 'GEMINI_UNAVAILABLE' : 'GEMINI_SERVICE_ERROR');
  publicError.retryable = transient;
  publicError.isGeminiServiceError = true;
  return publicError;
}

async function consultarReglamento(preguntaEmpleado, textoDocumento) {
  const prompt = `
        Eres el Asistente Virtual de Recursos Humanos de la empresa.
        Tu trabajo es responder las dudas de los empleados basándote ESTRICTAMENTE en el documento interno que te proporciono abajo.

        REGLAS ESTRICTAS:
        1. NO inventes información. Si la respuesta a la pregunta del empleado no se encuentra en el documento, debes responder EXACTAMENTE: "Lo siento, no tengo información sobre ese tema en el reglamento actual. Por favor, consulta directamente con el departamento de Recursos Humanos."
        2. Sé amable, claro y profesional.
        3. Si la información está, explícala de forma sencilla y directa.

        --- INICIO DEL DOCUMENTO DE LA EMPRESA ---
        ${textoDocumento}
        --- FIN DEL DOCUMENTO ---

        PREGUNTA DEL EMPLEADO: "${preguntaEmpleado}"
        `;

  const startedAt = Date.now();
  const primaryName = ragModelName();
  const primaryAttempts = attemptsFromEnv(process.env.GEMINI_RETRY_ATTEMPTS, 3);
  let lastError;
  let lastModelName = primaryName;
  let attempts = 0;

  try {
    const primary = modelForName(primaryName);
    const result = await withGeminiRetry(() => {
      attempts += 1;
      return primary.generateContent(prompt);
    }, {
      maxAttempts: primaryAttempts,
      onRetry: ({ attempt, status }) => console.warn('[RAG] Gemini temporalmente no disponible; reintento', { attempt, status }),
    });
    const texto = result?.response?.text?.();
    if (!texto || !texto.trim()) throw new Error('Respuesta vacía de Gemini');
    reportSuccess({ model: primaryName, startedAt, attempts, fallback: false, result });
    return texto;
  } catch (error) {
    lastError = error;
  }

  // Fallback opcional únicamente tras errores transitorios. Credenciales
  // inválidas y cuotas diarias agotadas no desencadenan llamadas adicionales.
  if (isTransient(lastError)) {
    try {
      const fallback = getFallbackModel();
      if (fallback) {
        lastModelName = fallback.name;
        console.warn('[RAG] Se utilizará el modelo de respaldo configurado');
        const result = await withGeminiRetry(() => {
          attempts += 1;
          return fallback.model.generateContent(prompt);
        }, {
          maxAttempts: 2,
          onRetry: ({ attempt, status }) => console.warn('[RAG] Reintento de respaldo', { attempt, status }),
        });
        const texto = result?.response?.text?.();
        if (!texto || !texto.trim()) throw new Error('Respuesta vacía del modelo de respaldo');
        reportSuccess({ model: fallback.name, startedAt, attempts, fallback: true, result });
        return texto;
      }
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }

  const safeError = toPublicGeminiError(lastError);
  console.warn('[RAG] Consulta no completada', {
    modelo: lastModelName,
    latenciaMs: Math.max(0, Date.now() - startedAt),
    statusProveedor: httpStatus(lastError),
    codigo: safeError.code,
  });
  throw safeError;
}

module.exports = { consultarReglamento, toPublicGeminiError, ragModelName, geminiUsage };
