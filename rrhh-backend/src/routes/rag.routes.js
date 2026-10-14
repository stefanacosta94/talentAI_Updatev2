const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarToken = require('../middlewares/authMiddleware');
const ragService = require('../services/ragService');

router.post('/chat', verificarToken, async (req, res, next) => {
  try {
    const { pregunta } = req.body;
    if (!pregunta) return res.status(400).json({ exito: false, error: 'Por favor formula una pregunta.' });
    const { data: documentos, error } = await supabase.from('base_conocimiento').select('contenido_texto');
    if (error || !documentos || documentos.length === 0) return res.status(500).json({ exito: false, error: 'Aún no hay manuales en la base de conocimiento.' });
    const textoContextoGlobal = documentos.map(doc => doc.contenido_texto).join('\n\n---\n\n');
    const respuestaIA = await ragService.consultarReglamento(pregunta, textoContextoGlobal);
    res.json({ exito: true, respuesta: respuestaIA });
  } catch (error) { next(error); }
});

module.exports = router;
