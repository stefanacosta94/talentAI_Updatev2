const supabase = require('../config/supabase');
const {
  withSupabaseRetry,
  createSupabaseError,
} = require('../utils/supabaseRetry');

async function obtenerUsuarioActual(idUsuario) {
  return withSupabaseRetry(
    () => supabase
      .from('usuarios')
      .select('id, rol')
      .eq('id', idUsuario)
      .maybeSingle(),
    { label: 'Validación de sesión administrativa' },
  );
}

// Revalida el rol contra la BD para no confiar en un rol obsoleto del JWT.
const adminOnly = async (req, res, next) => {
  try {
    if (!req.usuario?.id) {
      return res.status(401).json({ exito: false, error: 'Sesión inválida.' });
    }

    const { data: usuarioActual, error } = await obtenerUsuarioActual(req.usuario.id);

    if (error) {
      return next(createSupabaseError(error, 'No fue posible validar la sesión'));
    }

    if (!usuarioActual) {
      return res.status(401).json({ exito: false, error: 'La cuenta asociada a esta sesión ya no existe.' });
    }

    if (usuarioActual.rol !== 'admin') {
      return res.status(403).json({ exito: false, error: 'Acceso denegado. Se requieren privilegios de administrador.' });
    }

    req.usuario.rol = usuarioActual.rol;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = adminOnly;
