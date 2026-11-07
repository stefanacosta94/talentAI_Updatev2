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
const { configResendAuto } = require('../services/resendAutoWorker');
const { configuracionWebhook } = require('../services/resendWebhookService');
const { registrarAuditoria } = require('../services/auditService');

// Parámetros admitidos en los filtros de consulta. Nunca se interpolan valores
// arbitrarios en la sintaxis de filtros de PostgREST.
const MODOS_CONSULTA = new Set(['automatico', 'prueba_manual', 'sin_autorizacion']);
function busquedaSegura(valor) {
  const texto = String(valor || '').trim();
  if (texto.length > 80 || (texto && !/^[\p{L}\p{N}\s.@+-]+$/u.test(texto))) {
    throw new TypeError('Búsqueda inválida. Utiliza letras, números o caracteres de correo.');
  }
  return texto;
}


// El módulo contiene datos personales; todas las rutas son exclusivas del administrador.
router.use(verificarToken, adminOnly);

// Resumen seguro, sin exponer API Key ni correo privado de la cuenta.
router.get('/configuracion-envio', (req, res) => {
  const modo = String(process.env.EMAIL_MODE || 'mock');
  let configurado = false;
  if (modo === 'resend_test') {
    try { configResendTest(); configurado = true; } catch (_) { configurado = false; }
  }
  let automatico = false;
  let intervaloMs = null;
  let maxDiario = null;
  try {
    const cfg = configResendAuto();
    automatico = true;
    intervaloMs = cfg.intervaloMs;
    maxDiario = cfg.maxDiario;
  } catch (_) { /* modo seguro por defecto */ }
  let webhooksHabilitados = false;
  try { configuracionWebhook(); webhooksHabilitados = true; } catch (_) { /* deshabilitado */ }
  res.json({ exito: true, modo, configurado, automatico, intervaloMs, maxDiario,
    webhooks_habilitados: webhooksHabilitados, destinatario_real_habilitado: false });
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

// 8A.2: política general para eventos NUEVOS de Careers y transiciones ATS.
// El administrador habilita una vez la política; las notificaciones posteriores
// se autorizan por trigger en PostgreSQL, solo para el correo fijo de pruebas.
router.get('/politica-ats', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('notificaciones_auto_ats_politica')
      .select('habilitado,habilitado_en,actualizado_en').eq('id', 1).single();
    if (error || !data) {
      return res.status(503).json({ exito: false,
        error: 'No fue posible leer la política. Verifica que SQL 16c esté aplicado.' });
    }
    let trabajadorHabilitado = false;
    try { configResendAuto(); trabajadorHabilitado = true; } catch (_) { /* cerrado por defecto */ }
    return res.json({ exito: true, habilitado: data.habilitado === true,
      habilitado_en: data.habilitado_en || null,
      trabajador_habilitado: trabajadorHabilitado,
      destino: 'prueba_controlada',
      eventos_inmediatos: ['postulacion_recibida', 'en_revision', 'entrevista'],
      eventos_con_aprobacion: ['contratado', 'descartado'],
    });
  } catch (error) { next(error); }
});

router.post('/politica-ats', async (req, res, next) => {
  try {
    if (typeof req.body?.habilitado !== 'boolean') {
      return res.status(400).json({ exito: false, error: 'Valor de habilitación inválido.' });
    }
    // Nunca activar una política si no está validado el transporte de pruebas.
    if (req.body.habilitado === true) {
      try { configResendAuto(); }
      catch (_) { return res.status(409).json({ exito: false,
        error: 'Activa primero RESEND_AUTO_ENABLED y configura Resend para pruebas controladas.' }); }
    }
    const { data, error } = await supabase.rpc('talentai_configurar_autodespacho_ats', {
      p_habilitado: req.body.habilitado, p_actor: req.usuario.id,
    });
    if (error) return res.status(503).json({ exito: false,
      error: 'No fue posible actualizar la política de despacho ATS.' });
    if (data !== true) return res.status(409).json({ exito: false,
      error: 'La política no pudo cambiar de estado.' });
    await registrarAuditoria(req.usuario.id,
      req.body.habilitado ? 'Activar política automática por evento ATS' : 'Pausar política automática por evento ATS',
      'Notificaciones', 'Solo correo de pruebas; eventos futuros y aprobación de decisiones terminales');
    return res.json({ exito: true, habilitado: req.body.habilitado,
      mensaje: req.body.habilitado
        ? 'Política habilitada. Solo se armarán eventos nuevos de prueba.'
        : 'Política pausada. Las notificaciones pendientes propias de esta política se desarmaron.' });
  } catch (error) { next(error); }
});

// Resumen global: cuentas exactas calculadas en Supabase, no sobre una sola página.
// La última fecha corresponde a un EVENTO creado, no al último tick del worker.
router.get('/resumen', async (req, res, next) => {
  try {
    const estados = [
      ['total', null], ['pendientes', 'pendiente'], ['aceptados', 'aceptado_proveedor'],
      ['fallidos', 'fallido'], ['procesando', 'procesando'], ['revision', 'requiere_revision'],
    ];
    const [conteos, ultimo] = await Promise.all([
      Promise.all(estados.map(async ([clave, estado]) => {
        const { count, error } = await withSupabaseRetry(() => {
          let consulta = supabase.from('notificaciones_email')
            .select('id_notificacion', { count: 'exact', head: true });
          if (estado) consulta = consulta.eq('estado', estado);
          return consulta;
        }, { label: 'Indicadores de notificaciones' });
        if (error) throw createSupabaseError(error, 'No fue posible consultar indicadores');
        return [clave, Number(count || 0)];
      })),
      withSupabaseRetry(() => supabase.from('notificaciones_email')
        .select('creado_en').order('creado_en', { ascending: false }).limit(1),
      { label: 'Último evento de notificaciones' }),
    ]);
    if (ultimo.error) throw createSupabaseError(ultimo.error, 'No fue posible consultar último evento');
    const entrega = await Promise.all(['entregado', 'rebotado'].map(async (estado) => {
      const { count, error } = await supabase.from('notificaciones_email')
        .select('id_notificacion', { count: 'exact', head: true }).eq('entrega_estado', estado);
      if (error) throw createSupabaseError(error, 'No fue posible consultar confirmaciones de entrega');
      return [estado, Number(count || 0)];
    }));
    res.json({ exito: true, ...Object.fromEntries(conteos), ...Object.fromEntries(entrega),
      ultimo_evento_en: ultimo.data?.[0]?.creado_en || null });
  } catch (error) { next(error); }
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
    const evento = req.query.evento ? String(req.query.evento) : '';
    const modo = req.query.modo ? String(req.query.modo) : '';
    let buscar;
    try { buscar = busquedaSegura(req.query.buscar); }
    catch (_) { return res.status(400).json({ exito: false, error: 'Texto de búsqueda no permitido.' }); }
    if ((evento && !Object.prototype.hasOwnProperty.call(EVENTOS, evento)) ||
        (modo && !MODOS_CONSULTA.has(modo))) {
      return res.status(400).json({ exito: false, error: 'Filtro de notificaciones no permitido.' });
    }
    const offset = (pagina - 1) * limite;
    const { data, count, error } = await withSupabaseRetry(() => {
      let q = supabase.from('notificaciones_email')
        .select('id_notificacion, id_aplicacion, tipo_evento, destinatario_email, nombre_candidato, titulo_vacante, estado, intentos, max_intentos, proximo_intento_en, creado_en, enviado_en, entrega_estado, entrega_evento_en, entrega_verificado_en, datos, aprobado_en, prueba_resend_autorizada, auto_resend_autorizado, auto_resend_autorizado_en, id_mensaje_proveedor', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(offset, offset + limite - 1);
      if (estado) q = q.eq('estado', estado);
      if (evento) q = q.eq('tipo_evento', evento);
      if (modo === 'automatico') q = q.eq('auto_resend_autorizado', true);
      if (modo === 'prueba_manual') q = q.eq('prueba_resend_autorizada', true).eq('auto_resend_autorizado', false);
      if (modo === 'sin_autorizacion') q = q.eq('prueba_resend_autorizada', false);
      if (buscar) q = q.or(`nombre_candidato.ilike.%${buscar}%,destinatario_email.ilike.%${buscar}%`);
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

// Opt-in ADICIONAL 8A: la autorización manual de Fase 5D no basta para autoenvío.
router.post('/:id/autorizar-auto-resend', (req, res, next) => {
  try { configResendAuto(); } catch (error) { return next(error); }
  return accion(req, res, next, 'talentai_autorizar_auto_resend',
    'Autorización individual de despacho automático de PRUEBA', { p_actor: req.usuario.id });
});
router.post('/:id/revocar-auto-resend', (req, res, next) => accion(
  req, res, next, 'talentai_revocar_auto_resend',
  'Revocación de despacho automático de PRUEBA', { p_actor: req.usuario.id }
));

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

// Fase 8B: historial verificado de entrega (sin payload ni PII de Resend).
router.get('/:id/eventos-entrega', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id || '')) return res.status(400).json({ exito: false, error: 'Identificador inválido.' });
    const { data, error } = await supabase.from('notificaciones_resend_webhook_eventos')
      .select('tipo, ocurrido_en, recibido_en, procesado')
      .eq('id_notificacion', req.params.id).order('ocurrido_en', { ascending: false }).limit(50);
    if (error) throw createSupabaseError(error, 'No fue posible consultar confirmaciones de entrega');
    return res.json({ exito: true, eventos: data || [] });
  } catch (error) { next(error); }
});

// Reconciliación manual de metadatos ya firmados; nunca reenvía mensajes.
router.post('/conciliar-webhooks', async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('talentai_conciliar_webhooks_resend', { p_limite: 50 });
    if (error) return res.status(503).json({ exito: false, error: 'No fue posible conciliar eventos Resend.' });
    await registrarAuditoria(req.usuario.id, 'Conciliación de eventos de entrega Resend',
      'Notificaciones', `Eventos correlacionados: ${Number(data || 0)}`);
    return res.json({ exito: true, correlacionados: Number(data || 0) });
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
