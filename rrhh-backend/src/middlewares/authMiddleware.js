const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ exito: false, error: 'Acceso denegado. Se requiere un token Bearer.' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ exito: false, error: 'Acceso denegado. No se proporcionó un token de seguridad.' });
  }
  if (!process.env.JWT_SECRET) {
    return next(new Error('JWT_SECRET no está configurado en el servidor.'));
  }

  try {
    const usuarioDecodificado = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!usuarioDecodificado.id || !usuarioDecodificado.email || !usuarioDecodificado.rol) {
      return res.status(403).json({ exito: false, error: 'Token inválido o incompleto.' });
    }
    req.usuario = usuarioDecodificado;
    next();
  } catch (_) {
    return res.status(403).json({ exito: false, error: 'Token inválido o expirado. Por favor, inicia sesión nuevamente.' });
  }
};

module.exports = verificarToken;
