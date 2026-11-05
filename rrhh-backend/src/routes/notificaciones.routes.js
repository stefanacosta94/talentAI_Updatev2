'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarToken = require('../middlewares/authMiddleware');
const adminOnly = require('../middlewares/adminOnly');
const { withSupabaseRetry, createSupabaseError } = require('../utils/supabaseRetry');
const { EVENTOS, renderEmail } = require('../services/mailTemplates');
const { procesarLote, safeCount } = require('../services/notificationProcessor');
const { procesarUnaPrueba } = require('../services/resendTestProcessor');
const { configResendTest } = require('../services/resendTestTransport');
const { registrarAuditoria } = require('../services/auditService');

// El módulo contiene datos personales; todas las rutas son exclusivas del administrador.
router.use(verificarToken, adminOnly);

// Resumen seguro, sin exponer API Key ni correo privado de la cuenta.
router.get('/configuracion-envio', (req, res) => {
  const modo = String(process.env.EMAIL_MODE || 'mock');
  let configurado = false;
  if (modo === 'resend_test') {
    try { configResendTest(); configurado = true; } catch (_) { configurado = false; }
  }
  res.json({ exito: true, modo, configurado, destinatario_real_habilitado: false });
});

router.get('/plantillas', (req, res) => {
  res.json({ exito: true, modo: 'simulacion', eventos: Object.entries(EVENTOS).map(([codigo, v]) => ({ codigo, etiqueta: v.etiqueta })) });
});

router.get('/plantillas/:evento', (req, res) => {
  try {
    const correo = renderEmail({
      evento: req.params.evento,
      nombreCandidato: 'María Ejemplo',
      tituloVacante: 'Analista de Recursos Humanos',
      empresa: 'Empresa de demostración',
    });
    res.json({ exito: true, modo: 'simulacion', ...correo });
  } catch (error) {
    res.status(400).json({ exito: false, error: 'Plantilla de correo no reconocida.' });
  }
});

router.get('/', async (req, res, next) => {
  try {
    const pagina = Number(req.query.pagina || 1);
    const limite = Number(req.query.limite || 20);
    if (!Number.isInteger(pagina) || pagina < 1 || pagina > 10000 || !Number.isInteger(limite) || limite < 1 || limite > 50) {
      return res.status(400).json({ exito: false, error: 'Paginación no válida.' });
    }
    const estado = req.query.estado ? String(req.query.estado) : null;
    if (estado && !['pendiente', 'procesando', 'aceptado_proveedor', 'fallido', 'cancelado', 'requiere_revision'].includes(estado)) {
      return res.status(400).json({ exito: false, error: 'Filtro de estado no permitido.' });
    }
    const offset = (pagina - 1) * limite;
    const { data, count, error } = await withSupabaseRetry(() => {
      let q = supabase.from('notificaciones_email')
        .select('id_notificacion, id_aplicacion, tipo_evento, destinatario_email, nombre_candidato, titulo_vacante, estado, intentos, max_intentos, proximo_intento_en, creado_en, enviado_en, datos, aprobado_en, prueba_resend_autorizada, id_mensaje_proveedor', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(offset, offset + limite - 1);
      if (estado) q = q.eq('estado', estado);
      return q;
    }, { label: 'Consulta de notificaciones' });
    if (error) throw createSupabaseError(error, 'No fue posible cargar las notificaciones');
    res.json({ exito: true, registros: data || [], total: count || 0, pagina, limite, modo: String(process.env.EMAIL_MODE || 'mock') });
  } catch (error) { next(error); }
});


// Las mutaciones van exclusivamente por RPC atómicas con service_role.
// No se reintenta ninguna escritura automáticamente en Express.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function accion(req, res, next, nombre, etiqueta, extra = {}) {
  try {
    if (!UUID.test(req.params.id || '')) {
      return res.status(400).json({ exito: false, error: 'Identificador de notificación inválido.' });
    }
    const { data, error } = await supabase.rpc(nombre, { p_id: req.params.id, ...extra });
    if (error) return res.status(503).json({ exito: false, error: 'No fue posible actualizar la notificación.' });
    if (data !== true) return res.status(409).json({ exito: false, error: 'La notificación no admite esta acción en su estado actual.' });
    await registrarAuditoria(req.usuario.id, etiqueta, 'Notificaciones', `Notificación ID: ${req.params.id}`);
    return res.json({ exito: true, mensaje: 'Operación realizada.' });
  } catch (error) { next(error); }
}

router.post('/:id/aprobar', (req, res, next) => accion(
  req, res, next, 'talentai_aprobar_notificacion', 'Aprobación de notificación',
  { p_actor: req.usuario.id }
));
// Opt-in individual; incluso una notificación histórica no se envía por sí sola.
router.post('/:id/autorizar-prueba-resend', (req, res, next) => {
  try { configResendTest(); } catch (error) { return next(error); }
  return accion(req, res, next, 'talentai_autorizar_prueba_resend',
    'Autorización individual de prueba Resend', { p_actor: req.usuario.id });
});

router.post('/:id/cancelar', (req, res, next) => accion(
  req, res, next, 'talentai_cancelar_notificacion', 'Cancelación de notificación'
));
router.post('/:id/reprogramar', (req, res, next) => accion(
  req, res, next, 'talentai_reprogramar_notificacion', 'Reprogramación manual de notificación'
));

router.get('/:id/intentos', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id || '')) return res.status(400).json({ exito: false, error: 'Identificador inválido.' });
    const { data, error } = await withSupabaseRetry(
      () => supabase.from('notificaciones_email_intentos')
        .select('resultado, numero_intento, codigo_diagnostico, creado_en')
        .eq('id_notificacion', req.params.id)
        .order('creado_en', { ascending: false }).limit(50),
      { label: 'Historial de intentos de notificación' }
    );
    if (error) throw createSupabaseError(error, 'No fue posible consultar el historial');
    res.json({ exito: true, intentos: data || [] });
  } catch (error) { next(error); }
});

router.post('/procesar-simulacion', async (req, res, next) => {
  try {
    const limite = safeCount(req.body?.limite ?? 10);
    const resumen = await procesarLote({ limite });
    await registrarAuditoria(req.usuario.id, 'Procesamiento simulado', 'Notificaciones',
      `Reclamadas: ${resumen.reclamadas}; simuladas: ${resumen.simuladas}; fallidas: ${resumen.fallidas}`);
    res.json({ exito: true, modo: 'simulacion', ...resumen,
      mensaje: 'Simulación registrada. Ningún correo fue enviado.' });
  } catch (error) { next(error); }
});

// Único punto de envío externo: administrador + configuración + opt-in por fila.
router.post('/procesar-resend-prueba', async (req, res, next) => {
  try {
    configResendTest();
    const resumen = await procesarUnaPrueba();
    await registrarAuditoria(req.usuario.id, 'Procesamiento con Resend en prueba', 'Notificaciones',
      `Reclamadas: ${resumen.reclamadas}; aceptadas: ${resumen.aceptadas}; inciertas: ${resumen.inciertas}; sin finalizar: ${resumen.sin_finalizar}`);
    return res.json({ exito: true, modo: 'resend_test', ...resumen,
      mensaje: 'Prueba enviada solamente al destino configurado. Aceptación no equivale a entrega.' });
  } catch (error) { next(error); }
});

router.post('/conciliar-recepciones', async (req, res, next) => {
  try {
    const limite = safeCount(req.body?.limite ?? 100, 200);
    const { data, error } = await supabase.rpc('talentai_conciliar_recepciones', { p_limite: limite });
    if (error) return res.status(503).json({ exito: false, error: 'No fue posible conciliar las recepciones.' });
    await registrarAuditoria(req.usuario.id, 'Conciliación de recepciones ATS', 'Notificaciones',
      `Recepciones recuperadas: ${data}`);
    res.json({ exito: true, recuperadas: Number(data || 0),
      mensaje: 'Recepciones recuperadas requieren aprobación. No se recrean transiciones históricas.' });
  } catch (error) { next(error); }
});

module.exports = router;
