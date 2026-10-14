const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  isValidEmail,
  isStrongEnoughPassword,
  isAllowedRole,
  isPdfBuffer,
  validatePdfFile,
  safeFileComponent,
} = require('../src/security/securityUtils');

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Admin@Example.COM '), 'admin@example.com');
});

test('email validation accepts valid and rejects malformed values', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
});

test('password policy requires 8 to 128 characters', () => {
  assert.equal(isStrongEnoughPassword('1234567'), false);
  assert.equal(isStrongEnoughPassword('12345678'), true);
  assert.equal(isStrongEnoughPassword('x'.repeat(129)), false);
});

test('only supported user roles are accepted', () => {
  assert.equal(isAllowedRole('empleado'), true);
  assert.equal(isAllowedRole('admin'), true);
  assert.equal(isAllowedRole('superadmin'), false);
});

test('PDF validation checks MIME and magic bytes', () => {
  const pdf = Buffer.from('%PDF-1.7\nexample');
  const fake = Buffer.from('not a pdf');
  assert.equal(isPdfBuffer(pdf), true);
  assert.equal(isPdfBuffer(fake), false);
  assert.deepEqual(validatePdfFile({ mimetype: 'application/pdf', buffer: pdf }), { ok: true });
  assert.equal(validatePdfFile({ mimetype: 'text/plain', buffer: pdf }).ok, false);
  assert.equal(validatePdfFile({ mimetype: 'application/pdf', buffer: fake }).ok, false);
});

test('safeFileComponent strips unsafe path/name characters', () => {
  assert.equal(safeFileComponent('../../Mi CV (Final).pdf'), 'mi-cv-final-.pdf');
  assert.equal(safeFileComponent(''), 'archivo');
});
