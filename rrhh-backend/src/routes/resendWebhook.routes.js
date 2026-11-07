'use strict';
const express = require('express');
const { WebhookError, procesarWebhookFirmado } = require('../services/resendWebhookService');
const router = express.Router();

// Ruta pública solo en el sentido de que no requiere JWT: autenticación HMAC.
// Es imprescindible montarla ANTES de express.json() en index.js.
router.post('/', async (req, res) => {
  try {
    const resultado = await procesarWebhookFirmado({ body: req.body, headers: req.headers });
    // Nunca devolver payload, direcciones, claves, identificadores ni diagnóstico interno.
    console.info('[RESEND-WEBHOOK] Evento verificado', { resultado: resultado.resultado });
    return res.status(200).json({ recibido: true });
  } catch (err) {
    const status = err instanceof WebhookError ? err.status : 503;
    const codigo = err instanceof WebhookError ? err.code : 'INTERNAL_ERROR';
    console.warn('[RESEND-WEBHOOK] Evento rechazado', { codigo });
    return res.status(status).json({ recibido: false });
  }
});

module.exports = router;
