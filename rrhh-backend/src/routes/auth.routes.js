const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const {
  normalizeEmail,
  isValidEmail,
  isStrongEnoughPassword,
} = require('../security/securityUtils');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { exito: false, error: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.' },
});

// POST /api/auth/registrar
// El registro público NUNCA puede elegir privilegios. Todo usuario nuevo inicia como empleado.
router.post('/registrar', async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (nombre, email, password).' });
    }
    if (nombre.length > 120) {
      return res.status(400).json({ exito: false, error: 'El nombre excede la longitud permitida.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ exito: false, error: 'El correo electrónico no tiene un formato válido.' });
    }
    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({ exito: false, error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    }

    const contrasenaHasheada = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password_hash: contrasenaHasheada, rol: 'empleado' }])
      .select('id, nombre, email, rol')
      .single();

    if (error) {
      return res.status(400).json({ exito: false, error: 'El correo ya está registrado o los datos no son válidos.' });
    }

    res.status(201).json({ exito: true, mensaje: 'Usuario creado con éxito.', usuario: data });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ exito: false, error: 'Por favor ingresa tu correo y contraseña.' });
    }
    if (!isValidEmail(email)) {
      return res.status(401).json({ exito: false, error: 'Credenciales incorrectas.' });
    }

    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, password_hash, rol')
      .eq('email', email)
      .limit(1);

    if (error || !usuarios || usuarios.length === 0) {
      return res.status(401).json({ exito: false, error: 'Credenciales incorrectas.' });
    }

    const usuario = usuarios[0];
    const contrasenaValida = await bcrypt.compare(password, usuario.password_hash);
    if (!contrasenaValida) {
      return res.status(401).json({ exito: false, error: 'Credenciales incorrectas.' });
    }
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET no está configurado en el servidor.');
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256' },
    );

    res.json({
      exito: true,
      mensaje: '¡Bienvenido a la plataforma!',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
