'use strict';
const ATS_APPLICATION_STATES = Object.freeze([
  'Recibida',
  'En Revisión',
  'Entrevista',
  'Contratado',
  'Descartado',
]);

// Política de negocio inicial: progresión controlada y estados terminales.
// Mantener sincronizada con supabase/19_ats_transiciones_auditadas.sql.
const ATS_ALLOWED_TRANSITIONS = Object.freeze({
  Recibida: Object.freeze(['En Revisión', 'Descartado']),
  'En Revisión': Object.freeze(['Entrevista', 'Descartado']),
  Entrevista: Object.freeze(['En Revisión', 'Contratado', 'Descartado']),
  Contratado: Object.freeze([]),
  Descartado: Object.freeze([]),
});
function transicionesPermitidas(estado) {
  return ATS_ALLOWED_TRANSITIONS[estado] || [];
}

module.exports = { ATS_APPLICATION_STATES, ATS_ALLOWED_TRANSITIONS, transicionesPermitidas };
