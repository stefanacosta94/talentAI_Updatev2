const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarToken = require('../middlewares/authMiddleware');
const adminOnly = require('../middlewares/adminOnly');
const { registrarAuditoria } = require('../services/auditService');
const atsService = require('../services/atsService');
const { uploadPrivatePdf, createSignedUrl, removeStoredObject } = require('../services/storageService');
const { ATS_APPLICATION_STATES } = require('../constants/ats');
const { withSupabaseRetry, createSupabaseError } = require('../utils/supabaseRetry');
const { normalizeEmail, isValidEmail, isStrongEnoughPassword, isAllowedRole, validatePdfFile, safeFileComponent } = require('../security/securityUtils');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// Aplicar auth a todas las rutas de este router
router.use(verificarToken, adminOnly);

// ========== STATS ==========
router.get('/stats', async (req, res, next) => {
  try {
    const [vacantesRes, empleadosRes, aplicacionesRes] = await Promise.all([
      withSupabaseRetry(
        () => supabase.from('vacantes').select('id_vacante', { count: 'exact', head: true }),
        { label: 'Conteo de vacantes' },
      ),
      withSupabaseRetry(
        () => supabase.from('empleados').select('id_empleado', { count: 'exact', head: true }),
        { label: 'Conteo de empleados' },
      ),
      withSupabaseRetry(
        () => supabase.from('aplicaciones_ats').select('ai_match_score'),
        { label: 'Estadísticas ATS' },
      ),
    ]);

    for (const result of [vacantesRes, empleadosRes, aplicacionesRes]) {
      if (result.error) throw createSupabaseError(result.error, 'No fue posible cargar las estadísticas');
    }
    const scores = (aplicacionesRes.data || []).map(a => a.ai_match_score).filter(Boolean);
    const scorePromedio = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    res.json({ exito: true, stats: { total_vacantes: vacantesRes.count || 0, total_empleados: empleadosRes.count || 0, total_aplicaciones: aplicacionesRes.data?.length || 0, score_promedio_ia: scorePromedio } });
  } catch (error) { next(error); }
});

// ========== VACANTES ==========
router.post('/vacantes', async (req, res, next) => {
  try {
    const { titulo, descripcion_puesto, requisitos, id_departamento, estado } = req.body;
    if (!titulo || !descripcion_puesto) return res.status(400).json({ exito: false, error: 'El título y la descripción del puesto son obligatorios.' });
    const { data: vacanteNueva, error } = await supabase.from('vacantes').insert([{ titulo, descripcion_puesto, requisitos: requisitos || 'No especificados', id_departamento: id_departamento || 1, estado: estado || 'Activa' }]).select();
    if (error) throw new Error(error.message);
    await registrarAuditoria(req.usuario.id, 'Creación de Vacante', 'Vacantes', `Se creó la vacante: ${titulo} para el departamento ID: ${id_departamento || 'General'}`);
    res.status(201).json({ exito: true, mensaje: 'Vacante creada exitosamente.', vacante: vacanteNueva[0] });
  } catch (error) { next(error); }
});

router.get('/vacantes', async (req, res, next) => {
  try {
    const { data: vacantes, error } = await withSupabaseRetry(
      () => supabase.from('vacantes').select('*').order('id_vacante', { ascending: false }),
      { label: 'Carga de vacantes' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar las vacantes');
    res.json({ exito: true, total: vacantes.length, vacantes });
  } catch (error) { next(error); }
});

router.put('/vacantes/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { titulo, id_departamento, fecha_creacion, descripcion_puesto, requisitos } = req.body;
    const { data, error } = await supabase.from('vacantes').update({ titulo, id_departamento, fecha_creacion, descripcion_puesto, requisitos }).eq('id_vacante', id).select();
    if (error) throw new Error(error.message);
    res.json({ exito: true, mensaje: 'Vacante actualizada correctamente', vacante: data[0] });
  } catch (error) { next(error); }
});

router.delete('/vacantes/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('vacantes').delete().eq('id_vacante', id);
    if (error) throw new Error(error.message);
    await registrarAuditoria(req.usuario.id, 'Eliminación de Vacante', 'Vacantes', `Se eliminó la vacante ID: ${id}`);
    res.json({ exito: true, mensaje: 'Vacante eliminada de la base de datos' });
  } catch (error) { next(error); }
});

// ========== DEPARTAMENTOS ==========
router.get('/departamentos', async (req, res, next) => {
  try {
    const { data: departamentos, error } = await withSupabaseRetry(
      () => supabase.from('departamentos').select('id_departamento, nombre'),
      { label: 'Carga de departamentos' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar los departamentos');
    res.json({ exito: true, departamentos });
  } catch (error) { next(error); }
});

// ========== BITÁCORA ==========
router.get('/bitacora', async (req, res, next) => {
  try {
    const limite = req.query.limite ? parseInt(req.query.limite) : 50;
    const { data: historial, error } = await withSupabaseRetry(
      () => supabase.from('bitacora_auditoria').select('id_log, accion, modulo, detalle, fecha, usuarios (nombre, email)').order('fecha', { ascending: false }).limit(limite),
      { label: 'Carga de bitácora' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar la bitácora');
    res.json({ exito: true, total_mostrado: historial.length, registros: historial });
  } catch (error) { next(error); }
});

// ========== USUARIOS ==========
router.post('/usuarios', async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    const rol = req.body.rol || 'empleado';

    if (!nombre || !email || !password) return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (nombre, email, password).' });
    if (nombre.length > 120) return res.status(400).json({ exito: false, error: 'El nombre excede la longitud permitida.' });
    if (!isValidEmail(email)) return res.status(400).json({ exito: false, error: 'El correo electrónico no tiene un formato válido.' });
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ exito: false, error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
    if (!isAllowedRole(rol)) return res.status(400).json({ exito: false, error: 'El rol indicado no está permitido.' });

    const contrasenaHasheada = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password_hash: contrasenaHasheada, rol }])
      .select('id, nombre, email, rol, created_at')
      .single();
    if (error) return res.status(400).json({ exito: false, error: 'El correo ya está registrado o hay un error en los datos.' });

    await registrarAuditoria(req.usuario.id, 'Creación de Usuario', 'Usuarios', `Se creó el usuario: ${email} con rol ${rol}`);
    res.status(201).json({ exito: true, mensaje: 'Usuario creado exitosamente desde el panel.', usuario: data });
  } catch (error) { next(error); }
});

router.get('/usuarios', async (req, res, next) => {
  try {
    const { data: usuarios, error } = await withSupabaseRetry(
      () => supabase.from('usuarios').select('id, nombre, email, rol, created_at').order('created_at', { ascending: false }),
      { label: 'Carga de usuarios' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar los usuarios');
    res.json({ exito: true, total: usuarios.length, usuarios });
  } catch (error) { next(error); }
});

router.put('/usuarios/:id/rol', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nuevo_rol } = req.body;
    if (!nuevo_rol) return res.status(400).json({ exito: false, error: 'Debes enviar el nuevo_rol.' });
    if (!isAllowedRole(nuevo_rol)) return res.status(400).json({ exito: false, error: 'El rol indicado no está permitido.' });
    if (String(id) === String(req.usuario.id) && nuevo_rol !== 'admin') {
      return res.status(400).json({ exito: false, error: 'No puedes retirar tus propios privilegios de administrador durante una sesión activa.' });
    }
    const { data: usuarioActualizado, error } = await supabase.from('usuarios').update({ rol: nuevo_rol }).eq('id', id).select('id, nombre, email, rol');
    if (error) throw new Error(error.message);
    if (usuarioActualizado.length === 0) return res.status(404).json({ exito: false, error: 'Usuario no encontrado.' });
    await registrarAuditoria(req.usuario.id, 'Actualización de Rol', 'Usuarios', `Se asignó el rol: ${nuevo_rol} a ${usuarioActualizado[0].email}`);
    res.json({ exito: true, mensaje: 'Rol actualizado.', usuario: usuarioActualizado[0] });
  } catch (error) { next(error); }
});

// DELETE usuario
router.delete('/usuarios/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.usuario.id)) {
      return res.status(400).json({ exito: false, error: 'No puedes eliminar tu propio usuario durante una sesión activa.' });
    }
    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await registrarAuditoria(req.usuario.id, 'Eliminación de Usuario', 'Usuarios', `Se eliminó el usuario ID: ${id}`);
    res.json({ exito: true, mensaje: 'Usuario eliminado correctamente.' });
  } catch (error) { next(error); }
});

// ========== EMPLEADOS ==========
router.post('/empleados', async (req, res, next) => {
  try {
    const { nombre, correo, fecha_contratacion, id_departamento, id_rol, estado } = req.body;
    if (!nombre || !correo || !fecha_contratacion) return res.status(400).json({ exito: false, error: 'Nombre, correo y fecha de contratación son obligatorios.' });
    const { data: nuevoEmpleado, error } = await supabase.from('empleados').insert([{ nombre, correo, fecha_contratacion, id_departamento: id_departamento || null, id_rol: id_rol || null, estado: estado || 'Activo' }]).select();
    if (error) throw new Error(error.message);
    await registrarAuditoria(req.usuario.id, 'Alta de Empleado', 'Empleados', `Se registró al empleado: ${nombre}`);
    res.status(201).json({ exito: true, mensaje: 'Empleado registrado en RR.HH.', empleado: nuevoEmpleado[0] });
  } catch (error) { next(error); }
});

router.get('/empleados', async (req, res, next) => {
  try {
    const { data: empleados, error } = await withSupabaseRetry(
      () => supabase.from('empleados').select('id_empleado, nombre, correo, fecha_contratacion, estado, departamentos (nombre), roles (nombre_rol)').order('fecha_contratacion', { ascending: false }),
      { label: 'Carga de empleados' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar los empleados');
    res.json({ exito: true, total: empleados.length, empleados });
  } catch (error) { next(error); }
});

router.put('/empleados/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nombre, correo, fecha_contratacion, id_departamento, id_rol, estado } = req.body;
    const { data, error } = await supabase.from('empleados').update({ nombre, correo, fecha_contratacion, id_departamento, id_rol, estado }).eq('id_empleado', id).select();
    if (error) throw new Error(error.message);
    res.json({ exito: true, mensaje: 'Empleado actualizado correctamente.', empleado: data[0] });
  } catch (error) { next(error); }
});

router.delete('/empleados/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('empleados').delete().eq('id_empleado', id);
    if (error) throw new Error(error.message);
    await registrarAuditoria(req.usuario.id, 'Baja de Empleado', 'Empleados', `Se eliminó el empleado ID: ${id}`);
    res.json({ exito: true, mensaje: 'Empleado eliminado correctamente.' });
  } catch (error) { next(error); }
});

// ========== APLICACIONES ATS ==========
router.get('/aplicaciones', async (req, res, next) => {
  try {
    const { data: aplicaciones, error } = await withSupabaseRetry(
      () => supabase
        .from('aplicaciones_ats')
        .select('id_aplicacion, ai_match_score, ai_resumen_habilidades, estado_proceso, url_archivo_cv, candidatos (nombre, correo, telefono), vacantes (titulo, departamentos (nombre))')
        .order('ai_match_score', { ascending: false }),
      { label: 'Carga de aplicaciones ATS' },
    );

    if (error) throw createSupabaseError(error, 'No fue posible cargar las aplicaciones ATS');

    const aplicacionesSeguras = (aplicaciones || []).map((aplicacion) => ({
      ...aplicacion,
      tiene_cv: Boolean(aplicacion.url_archivo_cv),
      // La ruta privada no se expone al navegador. La URL firmada se genera al solicitarla.
      url_archivo_cv: undefined,
    }));

    res.json({
      exito: true,
      total: aplicacionesSeguras.length,
      aplicaciones: aplicacionesSeguras,
    });
  } catch (error) { next(error); }
});

router.get('/aplicaciones/:id/cv-url', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: aplicacion, error } = await withSupabaseRetry(
      () => supabase
        .from('aplicaciones_ats')
        .select('id_aplicacion, url_archivo_cv')
        .eq('id_aplicacion', id)
        .maybeSingle(),
      { label: 'Obtención del CV del candidato' },
    );

    if (error) throw createSupabaseError(error, 'No fue posible consultar el CV');
    if (!aplicacion) {
      return res.status(404).json({ exito: false, error: 'Aplicación no encontrada.' });
    }
    if (!aplicacion.url_archivo_cv) {
      return res.status(404).json({ exito: false, error: 'La aplicación no tiene un CV asociado.' });
    }

    const url = await createSignedUrl('curriculums', aplicacion.url_archivo_cv);
    res.json({ exito: true, url, expira_en_segundos: 5 * 60 });
  } catch (error) { next(error); }
});

router.put('/aplicaciones/:id/estado', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const estadoProceso = String(req.body.estado_proceso || '').trim();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ exito: false, error: 'La aplicación indicada no es válida.' });
    }
    if (!ATS_APPLICATION_STATES.includes(estadoProceso)) {
      return res.status(400).json({
        exito: false,
        error: `Estado no permitido. Valores válidos: ${ATS_APPLICATION_STATES.join(', ')}.`,
      });
    }

    const { data, error } = await supabase
      .from('aplicaciones_ats')
      .update({ estado_proceso: estadoProceso })
      .eq('id_aplicacion', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return res.status(404).json({ exito: false, error: 'Aplicación no encontrada.' });
    }

    res.json({
      exito: true,
      mensaje: 'Estado del candidato actualizado correctamente.',
      aplicacion: data,
    });
  } catch (error) { next(error); }
});

// ========== DOCUMENTOS (BASE CONOCIMIENTO) ==========
router.post('/documentos', upload.single('archivo_documento'), async (req, res, next) => {
  try {
    const validacionPDF = validatePdfFile(req.file);
    if (!validacionPDF.ok) return res.status(400).json({ exito: false, error: validacionPDF.error });
    const titulo = String(req.body.titulo || '').trim();
    if (!titulo) return res.status(400).json({ exito: false, error: 'El título del documento es obligatorio.' });
    if (titulo.length > 180) return res.status(400).json({ exito: false, error: 'El título del documento excede la longitud permitida.' });
    const contenidoExtraido = await atsService.extraerTextoPDF(req.file.buffer);
    const nombreUnico = `doc_${Date.now()}_${safeFileComponent(req.file.originalname, 'documento.pdf')}`;
    const storagePath = await uploadPrivatePdf(
      'documentos_empresa',
      nombreUnico,
      req.file.buffer,
    );

    const { data: documentoGuardado, error: dbError } = await supabase
      .from('base_conocimiento')
      .insert([{
        titulo,
        contenido_texto: contenidoExtraido,
        // Compatibilidad con el esquema actual: la columna almacena ahora la ruta privada.
        url_archivo: storagePath,
      }])
      .select()
      .single();

    if (dbError) {
      // Evita dejar archivos huérfanos cuando falle la escritura en BD.
      await removeStoredObject('documentos_empresa', storagePath).catch(() => {});
      throw new Error(`Error BD: ${dbError.message}`);
    }

    const signedUrl = await createSignedUrl('documentos_empresa', storagePath);
    documentoGuardado.url_archivo = signedUrl;

    res.status(201).json({
      exito: true,
      mensaje: 'Documento procesado y respaldado en la nube.',
      url_documento: signedUrl,
      documento: documentoGuardado,
    });
  } catch (error) { next(error); }
});

router.get('/documentos', async (req, res, next) => {
  try {
    const { data: documentos, error } = await withSupabaseRetry(
      () => supabase
        .from('base_conocimiento')
        .select('id_documento, titulo, fecha_actualizacion, url_archivo')
        .order('fecha_actualizacion', { ascending: false }),
      { label: 'Carga de base de conocimiento' },
    );

    if (error) throw createSupabaseError(error, 'No fue posible cargar la base de conocimiento');

    const documentosSeguros = (documentos || []).map((documento) => ({
      ...documento,
      tiene_archivo: Boolean(documento.url_archivo),
      // La ruta privada no se expone al navegador. La URL firmada se genera al solicitarla.
      url_archivo: undefined,
    }));

    res.json({
      exito: true,
      total: documentosSeguros.length,
      documentos: documentosSeguros,
    });
  } catch (error) { next(error); }
});

router.get('/documentos/:id/url', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: documento, error } = await withSupabaseRetry(
      () => supabase
        .from('base_conocimiento')
        .select('id_documento, url_archivo')
        .eq('id_documento', id)
        .maybeSingle(),
      { label: 'Obtención de documento privado' },
    );

    if (error) throw createSupabaseError(error, 'No fue posible consultar el documento');
    if (!documento) {
      return res.status(404).json({ exito: false, error: 'Documento no encontrado.' });
    }
    if (!documento.url_archivo) {
      return res.status(404).json({ exito: false, error: 'El documento no tiene un archivo asociado.' });
    }

    const url = await createSignedUrl('documentos_empresa', documento.url_archivo);
    res.json({ exito: true, url, expira_en_segundos: 5 * 60 });
  } catch (error) { next(error); }
});

router.delete('/documentos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: documento, error: findError } = await supabase
      .from('base_conocimiento')
      .select('id_documento, url_archivo')
      .eq('id_documento', id)
      .maybeSingle();

    if (findError) throw new Error(findError.message);
    if (!documento) {
      return res.status(404).json({ exito: false, error: 'Documento no encontrado.' });
    }

    await removeStoredObject('documentos_empresa', documento.url_archivo);

    const { error } = await supabase
      .from('base_conocimiento')
      .delete()
      .eq('id_documento', id);

    if (error) throw new Error(error.message);

    await registrarAuditoria(
      req.usuario.id,
      'Eliminación de Documento',
      'Base Conocimiento',
      `Se eliminó el documento ID: ${id}`,
    );

    res.json({ exito: true, mensaje: 'Documento eliminado correctamente.' });
  } catch (error) { next(error); }
});


// ========== ROLES ==========
router.get('/roles', async (req, res, next) => {
  try {
    const { data: roles, error } = await withSupabaseRetry(
      () => supabase.from('roles').select('id_rol, nombre_rol'),
      { label: 'Carga de roles' },
    );
    if (error) throw createSupabaseError(error, 'No fue posible cargar los roles');
    res.json({ exito: true, roles });
  } catch (error) { next(error); }
});
module.exports = router;
