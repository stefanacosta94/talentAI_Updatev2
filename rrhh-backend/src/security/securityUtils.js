const ALLOWED_USER_ROLES = Object.freeze(['empleado', 'admin']);
const PDF_MIME_TYPES = new Set(['application/pdf']);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  const value = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function isAllowedRole(role) {
  return ALLOWED_USER_ROLES.includes(role);
}

function isPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function validatePdfFile(file) {
  if (!file) {
    return { ok: false, error: 'El archivo PDF es obligatorio.' };
  }
  if (!PDF_MIME_TYPES.has(file.mimetype)) {
    return { ok: false, error: 'El archivo debe tener tipo MIME application/pdf.' };
  }
  if (!isPdfBuffer(file.buffer)) {
    return { ok: false, error: 'El contenido del archivo no corresponde a un PDF válido.' };
  }
  return { ok: true };
}

function safeFileComponent(value, fallback = 'archivo') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

module.exports = {
  ALLOWED_USER_ROLES,
  normalizeEmail,
  isValidEmail,
  isStrongEnoughPassword,
  isAllowedRole,
  isPdfBuffer,
  validatePdfFile,
  safeFileComponent,
};
