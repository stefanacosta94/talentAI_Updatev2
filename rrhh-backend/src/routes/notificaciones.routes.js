'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarToken = require('../middlewares/authMiddleware');
const adminOnly = require('../middlewares/adminOnly');
const { withSupabaseRetry, createSupabaseError } = require('../utils/supabaseRetry');
const { EVENTOS, renderEmail } = require('../services/mailTemplates');

// El módulo contiene datos personales; todas las rutas son exclusivas del administrador.
router.use(verificarToken, adminOnly);

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
    if (estado && !['pendiente', 'procesando', 'aceptado_proveedor', 'fallido', 'cancelado'].includes(estado)) {
      return res.status(400).json({ exito: false, error: 'Filtro de estado no permitido.' });
    }
    const offset = (pagina - 1) * limite;
    const { data, count, error } = await withSupabaseRetry(() => {
      let q = supabase.from('notificaciones_email')
        .select('id_notificacion, tipo_evento, destinatario_email, nombre_candidato, titulo_vacante, estado, intentos, creado_en, enviado_en', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(offset, offset + limite - 1);
      if (estado) q = q.eq('estado', estado);
      return q;
    }, { label: 'Consulta de notificaciones' });
    if (error) throw createSupabaseError(error, 'No fue posible cargar las notificaciones');
    res.json({ exito: true, registros: data || [], total: count || 0, pagina, limite, modo: 'simulacion' });
  } catch (error) { next(error); }
});

module.exports = router;
