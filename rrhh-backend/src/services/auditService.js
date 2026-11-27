const supabase = require('../config/supabase');

async function registrarAuditoria(id_usuario, accion, modulo, detalle) {
  try {
    const { error } = await supabase.from('bitacora_auditoria').insert([{ id_usuario, accion, modulo, detalle }]);
    if (error) {
      console.error('No fue posible guardar la auditoría:', error.code || 'DB_ERROR');
      return false;
    }
    console.log(`👁️ Auditoría registrada: [${modulo}] ${accion}`);
    return true;
  } catch (error) {
    console.error('❌ Error guardando en bitácora:', error.code || 'DB_ERROR');
    return false;
  }
}

module.exports = { registrarAuditoria };
