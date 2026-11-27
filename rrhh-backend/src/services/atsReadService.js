'use strict';

const { ATS_APPLICATION_STATES } = require('../constants/ats');
const { withSupabaseRetry, createSupabaseError } = require('../utils/supabaseRetry');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 100000;
const MAX_SEARCH_LENGTH = 100;

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function positiveInt(value, name, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const stringValue = String(value);
  if (!/^[1-9]\d*$/.test(stringValue)) throw validationError(`${name} debe ser un entero positivo.`);
  const numericValue = Number(stringValue);
  if (!Number.isSafeInteger(numericValue) || numericValue > max) {
    throw validationError(`${name} supera el máximo permitido (${max}).`);
  }
  return numericValue;
}

function normalizarFiltros(query = {}) {
  const pagina = positiveInt(query.pagina, 'pagina', 1, MAX_PAGE);
  const limite = positiveInt(query.limite, 'limite', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const busqueda = String(query.busqueda ?? '').trim().replace(/\s+/g, ' ');
  if (busqueda.length > MAX_SEARCH_LENGTH) {
    throw validationError(`La búsqueda admite hasta ${MAX_SEARCH_LENGTH} caracteres.`);
  }
  const estado = String(query.estado ?? '').trim();
  if (estado && !ATS_APPLICATION_STATES.includes(estado)) {
    throw validationError('El estado ATS solicitado no es válido.');
  }
  const idVacante = positiveInt(query.id_vacante, 'id_vacante', null, 2147483647);
  return {
    p_pagina: pagina,
    p_limite: limite,
    p_busqueda: busqueda || null,
    p_estado: estado || null,
    p_id_vacante: idVacante,
  };
}

async function obtenerPaginaAts(supabase, query = {}) {
  const parametros = normalizarFiltros(query);
  const { data, error } = await withSupabaseRetry(
    () => supabase.rpc('ats_listar_aplicaciones_paginadas', parametros),
    { label: 'Listado paginado ATS' },
  );
  if (error) throw createSupabaseError(error, 'No fue posible cargar las aplicaciones ATS');
  if (!data || !Array.isArray(data.aplicaciones) || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('La función de paginación ATS devolvió una respuesta inválida.');
  }
  return { ...data, pagina: parametros.p_pagina, limite: parametros.p_limite };
}

async function obtenerEstadisticasAts(supabase) {
  const { data, error } = await withSupabaseRetry(
    () => supabase.rpc('ats_estadisticas_panel'),
    { label: 'Métricas agregadas ATS' },
  );
  if (error) throw createSupabaseError(error, 'No fue posible cargar las estadísticas ATS');
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.total_aplicaciones)) {
    throw new Error('La función de métricas ATS devolvió una respuesta inválida.');
  }
  return data;
}

module.exports = {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH,
  normalizarFiltros, obtenerPaginaAts, obtenerEstadisticasAts,
};
