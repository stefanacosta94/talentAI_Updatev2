const supabase = require('../config/supabase');

async function registrarAuditoria(id_usuario, accion, modulo, detalle) {
  try {
    await supabase.from('bitacora_auditoria').insert([{ id_usuario, accion, modulo, detalle }]);
    console.log(`👁️ Auditoría registrada: [${modulo}] ${accion}`);
  } catch (error) {
    console.error('❌ Error guardando en bitácora:', error.message);
  }
}

module.exports = { registrarAuditoria };
