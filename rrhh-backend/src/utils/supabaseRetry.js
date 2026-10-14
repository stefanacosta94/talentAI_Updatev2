const RETRYABLE_MESSAGES = [
  'gateway timeout',
  'timeout',
  '502',
  '503',
  '504',
  'fetch failed',
  'network',
  'econnreset',
  'etimedout',
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableSupabaseError(error) {
  if (!error) return false;

  const status = Number(error.status || error.statusCode || error.code);
  if ([502, 503, 504].includes(status)) return true;

  const message = String(error.message || error.details || error.hint || '').toLowerCase();
  return RETRYABLE_MESSAGES.some((value) => message.includes(value));
}

async function withSupabaseRetry(operation, options = {}) {
  const {
    label = 'consulta Supabase',
    attempts = 3,
    baseDelayMs = 350,
  } = options;

  let lastResult = null;
  let lastThrownError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      lastResult = result;

      if (!result?.error) return result;

      if (!isRetryableSupabaseError(result.error) || attempt === attempts) {
        return result;
      }

      const delay = baseDelayMs * (2 ** (attempt - 1));
      console.warn(
        `⚠️ ${label} falló temporalmente (${result.error.message}). ` +
        `Reintento ${attempt}/${attempts - 1} en ${delay} ms...`,
      );
      await wait(delay);
    } catch (error) {
      lastThrownError = error;

      if (!isRetryableSupabaseError(error) || attempt === attempts) {
        throw error;
      }

      const delay = baseDelayMs * (2 ** (attempt - 1));
      console.warn(
        `⚠️ ${label} lanzó un error temporal (${error.message}). ` +
        `Reintento ${attempt}/${attempts - 1} en ${delay} ms...`,
      );
      await wait(delay);
    }
  }

  if (lastThrownError) throw lastThrownError;
  return lastResult;
}

function createSupabaseError(error, context = 'Supabase') {
  const err = new Error(`${context}: ${error?.message || 'Error desconocido'}`);
  err.status = isRetryableSupabaseError(error) ? 503 : 500;
  return err;
}

module.exports = {
  isRetryableSupabaseError,
  withSupabaseRetry,
  createSupabaseError,
};
