'use strict';
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const router = express.Router();
const supabase = require('../config/supabase');
const identity = require('../services/candidateIdentityService');
const { uploadPrivatePdf, removeStoredObject } = require('../services/storageService');
const { withSupabaseRetry, createSupabaseError } = require('../utils/supabaseRetry');
const { normalizeEmail, isValidEmail, validatePdfFile, safeFileComponent } = require('../security/securityUtils');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
// Límites locales: para varias instancias, usar store compartido (p.ej. Redis).
const limitarPostulaciones = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { exito: false, error: 'Demasiadas solicitudes desde esta conexión. Intenta más tarde.' },
});
const limitarCodigos = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { exito: false, error: 'Demasiadas verificaciones. Intenta nuevamente más tarde.' },
});
router.use('/aplicar', limitarPostulaciones);
router.use('/verificacion/iniciar', limitarCodigos);

router.get('/vacantes', async (req, res, next) => {
  try {
    const { data: vacantes, error } = await withSupabaseRetry(
      () => supabase.from('vacantes')
        .select('id_vacante, titulo, descripcion_puesto, requisitos, estado, fecha_creacion, departamentos (nombre)')
        .eq('estado', 'Activa'),
      { label: 'Carga pública de vacantes', attempts: 3 },
    );
    if (error) throw createSupabaseError(error, 'No fue posible consultar las vacantes');
    res.json({ exito: true, total: vacantes.length, vacantes });
  } catch (error) { next(error); }
});

router.post('/verificacion/iniciar', async (req, res, next) => {
  try {
    const correo = normalizeEmail(req.body?.correo);
    if (!isValidEmail(correo)) {
      return res.status(400).json({ exito: false, error: 'El correo electrónico no es válido.' });
    }
    await identity.iniciarVerificacion(correo);
    // Nunca revelar si existe o no un candidato con este email ni si hubo cooldown.
    return res.status(202).json({
      exito: true, verificacion_requerida: true,
      mensaje: 'Si es posible enviar la verificación, recibirás un código en tu correo. Revisa tu bandeja y spam.',
    });
  } catch (error) { next(error); }
});

router.post('/aplicar', upload.single('archivo_cv'), async (req, res, next) => {
  let storagePathCV = null;
  try {
    const idVacante = Number(req.body.id_vacante);
    const nombre = String(req.body.nombre || '').trim();
    const correo = normalizeEmail(req.body.correo);
    const codigo = String(req.body.codigo_verificacion || '').trim();
    const telefono = String(req.body.telefono || '').trim();
    const linkedin = String(req.body.linkedin || '').trim();
    const archivo = req.file;

    if (!Number.isInteger(idVacante) || idVacante <= 0) {
      return res.status(400).json({ exito: false, error: 'La vacante indicada no es válida.' });
    }
    if (!nombre || nombre.length > 120) {
      return res.status(400).json({ exito: false, error: 'El nombre es obligatorio y debe tener máximo 120 caracteres.' });
    }
    if (!isValidEmail(correo)) {
      return res.status(400).json({ exito: false, error: 'El correo electrónico no tiene un formato válido.' });
    }
    if (!/^\d{6}$/.test(codigo)) {
      return res.status(400).json({ exito: false, error: 'Es necesario ingresar el código de seis dígitos enviado a tu correo.' });
    }
    if (telefono.length > 40 || linkedin.length > 300) {
      return res.status(400).json({ exito: false, error: 'Teléfono o enlace de LinkedIn exceden la longitud permitida.' });
    }
    const validacionPDF = validatePdfFile(archivo);
    if (!validacionPDF.ok) {
      return res.status(400).json({ exito: false, error: validacionPDF.error });
    }
    // Verificar vacante antes de almacenar PDF. SQL vuelve a comprobarla dentro
    // de la transacción por si se desactiva entre la consulta y el INSERT.
    const { data: vacante, error: errorVacante } = await supabase.from('vacantes')
      .select('id_vacante, estado').eq('id_vacante', idVacante).maybeSingle();
    if (errorVacante) throw new Error('No fue posible consultar la vacante.');
    if (!vacante) return res.status(404).json({ exito: false, error: 'No se encontró la vacante especificada.' });
    if (vacante.estado !== 'Activa') {
      return res.status(409).json({ exito: false, error: 'La vacante ya no se encuentra activa.' });
    }

    // Fallar antes del upload cuando no hay transporte de verificación configurado.
    identity.configVerificacion();
    const nombreArchivo = `cv_${randomUUID()}_${safeFileComponent(nombre, 'candidato')}.pdf`;
    storagePathCV = await uploadPrivatePdf('curriculums', nombreArchivo, archivo.buffer);
    const confirmacion = await identity.confirmarPostulacion({
      correo, codigo, nombre, telefono, linkedin,
      idVacante, cvPath: storagePathCV,
    });
    if (!confirmacion || confirmacion.resultado !== 'creada') {
      const estados = {
        codigo_invalido: [400, 'Código incorrecto o ya utilizado. Comprueba el correo y solicita uno nuevo si es necesario.'],
        codigo_expirado: [410, 'El código ha caducado. Solicita uno nuevo.'],
        codigo_bloqueado: [429, 'Se agotaron los intentos. Solicita un nuevo código cuando esté permitido.'],
        ya_postulado: [409, 'Ya existe una postulación para esta vacante con el correo verificado.'],
        vacante_inactiva: [409, 'La vacante ya no se encuentra activa.'],
        solicitud_invalida: [400, 'Los datos de postulación son inválidos.'],
      };
      const [status, mensaje] = estados[confirmacion?.resultado] || [503, 'No fue posible confirmar la postulación.'];
      return res.status(status).json({ exito: false, error: mensaje });
    }
    // Inserción y consumo de código en una transacción; triggers 11 y 18
    // registran notificación y evaluación IA. El CV persistido ya es referenciado.
    storagePathCV = null;
    return res.status(201).json({
      exito: true, id_aplicacion: confirmacion.id_aplicacion,
      evaluacion_ia: 'pendiente', correo_verificado: true,
      mensaje: 'Postulación recibida y correo verificado correctamente.',
    });
  } catch (error) { next(error); }
  finally {
    if (storagePathCV) {
      try { await removeStoredObject('curriculums', storagePathCV); }
      catch (error) { console.error('[ATS-PUBLIC] No se pudo limpiar CV temporal.', { codigo: error.code }); }
    }
  }
});
module.exports = router;
