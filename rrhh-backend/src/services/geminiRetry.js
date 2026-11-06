'use strict';

// Los 503 de Gemini son transitorios. No repetir errores de autenticación,
// modelos inválidos ni cuotas diarias agotadas: repetirlos no los solucionaría.
function httpStatus(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function isTransient(error) {
  const status = httpStatus(error);
  if ([408, 500, 502, 503, 504].includes(status)) return true;
  if (status === 429) {
    const info = String(error?.message || '');
    return !/daily quota|quota.exceeded|exceeded your quota|free.tier.quota|per.day|day limit|limit: 0/i.test(info);
  }
  if (status) return false;
  const text = String(error?.message || '');
  return /fetch failed|network error|econnreset|etimedout|eai_again|socket hang up/i.test(text);
}

function attemptsFromEnv(value, fallback = 3) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 4 ? count : fallback;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withGeminiRetry(request, {
  maxAttempts = 3,
  baseDelayMs = 700,
  wait = sleep,
  onRetry = () => {},
} = {}) {
  if (typeof request !== 'function') throw new TypeError('request debe ser una función');
  const count = attemptsFromEnv(maxAttempts, 3);
  for (let attempt = 1; attempt <= count; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!isTransient(error) || attempt === count) throw error;
      onRetry({ attempt, status: httpStatus(error) });
      // Backoff acotado; el ligero jitter evita sincronizar peticiones simultáneas.
      const delay = Math.min(3000, baseDelayMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150);
      await wait(delay);
    }
  }
}

module.exports = { httpStatus, isTransient, attemptsFromEnv, withGeminiRetry };
