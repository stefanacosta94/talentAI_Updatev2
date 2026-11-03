'use strict';
// Vista previa en CLI sin enviar ni registrar nada.
const { EVENTOS, renderEmail } = require('../src/services/mailTemplates');
const evento = process.argv[2] || 'postulacion_recibida';
if (!Object.hasOwn(EVENTOS, evento)) {
  console.error(`Evento no válido. Opciones: ${Object.keys(EVENTOS).join(', ')}`);
  process.exitCode = 1;
} else {
  const correo = renderEmail({ evento, nombreCandidato: 'María Ejemplo', tituloVacante: 'Analista de Recursos Humanos', empresa: 'Empresa de demostración' });
  console.log(`Asunto: ${correo.asunto}\n\n${correo.texto}\n\n[SIMULACIÓN - no se ha enviado ningún correo]`);
}
