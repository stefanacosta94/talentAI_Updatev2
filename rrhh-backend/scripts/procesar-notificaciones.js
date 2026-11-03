#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { procesarLote, assertMockMode } = require('../src/services/notificationProcessor');

// Se inicia manualmente desde rrhh-backend/:
// node scripts/procesar-notificaciones.js --once
// node scripts/procesar-notificaciones.js --loop
// No se auto-inicia con npm start y nunca envía correo real.
const modo = process.argv[2] || '--once';
if (!['--once', '--loop'].includes(modo)) {
  console.error('Uso: node scripts/procesar-notificaciones.js [--once|--loop]');
  process.exitCode = 2;
} else {
  let detener = false;
  process.on('SIGINT', () => { detener = true; });
  process.on('SIGTERM', () => { detener = true; });
  const intervalo = 60_000;
  (async () => {
    assertMockMode();
    do {
      const resultado = await procesarLote({ limite: 10 });
      console.log(`Simulación: ${resultado.simuladas}; fallidas: ${resultado.fallidas}; por revisar: ${resultado.sin_finalizar}. Correos reales: 0.`);
      if (modo === '--once' || detener) break;
      await new Promise(resolve => {
        let t;
        const stop = () => {
          clearTimeout(t);
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          resolve();
        };
        t = setTimeout(stop, intervalo);
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    } while (!detener);
  })().catch(() => {
    console.error('No fue posible procesar la cola simulada. Revisa configuración y Supabase.');
    process.exitCode = 1;
  });
}
