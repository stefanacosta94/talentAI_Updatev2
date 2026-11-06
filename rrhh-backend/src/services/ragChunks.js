'use strict';
const crypto = require('node:crypto');

const CHUNK_SIZE = 1700;
const OVERLAP = 180;
const CHUNK_FORMAT_VERSION = 'talentai-rag-fragmentos-v1';

function fragmentarTexto(texto, { size = CHUNK_SIZE, overlap = OVERLAP } = {}) {
  if (!Number.isInteger(size) || size < 300 || size > 2100 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size / 2) {
    throw new Error('Configuración de fragmentación no válida.');
  }
  const clean = String(texto || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const from = start + Math.floor(size * 0.65);
      const split = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (split >= from) end = split + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
    if (chunks.length >= 5000) throw new Error('Documento demasiado extenso para el índice actual.');
  }
  return chunks;
}

function fingerprint(texto) {
  return crypto.createHash('md5').update(String(texto || ''), 'utf8').digest('hex');
}

function versionDeterministica(id, hash, modelo) {
  const hex = crypto.createHash('sha256').update(`${CHUNK_FORMAT_VERSION}:${id}:${hash}:${modelo}:${CHUNK_SIZE}:${OVERLAP}`).digest('hex').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

module.exports = { CHUNK_SIZE, OVERLAP, CHUNK_FORMAT_VERSION, fragmentarTexto, fingerprint, versionDeterministica };
