const supabase = require('../config/supabase');

const DEFAULT_SIGNED_URL_SECONDS = 5 * 60;

function normalizeStoragePath(value, bucket) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // Nuevos registros: almacenamos únicamente la ruta del objeto.
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, '');
  }

  // Compatibilidad con registros antiguos que guardaban getPublicUrl().
  try {
    const url = new URL(raw);
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
    ];

    for (const prefix of prefixes) {
      const index = url.pathname.indexOf(prefix);
      if (index !== -1) {
        return decodeURIComponent(url.pathname.slice(index + prefix.length));
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function uploadPrivatePdf(bucket, path, buffer) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (error) {
    throw new Error(`No fue posible almacenar el PDF en ${bucket}: ${error.message}`);
  }

  return path;
}

async function createSignedUrl(bucket, storedValue, expiresIn = DEFAULT_SIGNED_URL_SECONDS) {
  const path = normalizeStoragePath(storedValue, bucket);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`No fue posible generar el acceso temporal al archivo: ${error.message}`);
  }

  return data?.signedUrl || null;
}

async function removeStoredObject(bucket, storedValue) {
  const path = normalizeStoragePath(storedValue, bucket);
  if (!path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`No fue posible eliminar el archivo de ${bucket}: ${error.message}`);
  }
}

module.exports = {
  DEFAULT_SIGNED_URL_SECONDS,
  normalizeStoragePath,
  uploadPrivatePdf,
  createSignedUrl,
  removeStoredObject,
};
