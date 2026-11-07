'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configResendTest, prepararMensajePrueba, enviarResendPrueba } = require('../src/services/resendTestTransport');
const { procesarUnaPrueba } = require('../src/services/resendTestProcessor');
const UUID1 = '1f7338e8-a1ed-46e2-b82b-d42daea43ddd';
const UUID2 = '84aaafc2-dbc5-4b3e-aadd-5ec071f6b343';
const ENV = {
  EMAIL_MODE: 'resend_test', RESEND_TEST_ENABLED: 'true',
  RESEND_API_KEY: 're_ejemplo_muy_falso',
  RESEND_TEST_TO: 'delivered@resend.dev',
};
const raiz = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(raiz, 'supabase/13_notifications_resend_test.sql'), 'utf8');
const rutas = fs.readFileSync(path.join(raiz, 'rrhh-backend/src/routes/notificaciones.routes.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'rrhh-frontend/notificaciones.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'rrhh-frontend/js/notificaciones.js'), 'utf8');

test('5D: entorno mock por defecto y activación de prueba de doble condición', () => {
  for (const env of [{}, {...ENV, EMAIL_MODE:'mock'}, {...ENV, RESEND_TEST_ENABLED:'false'}, {...ENV, RESEND_API_KEY:''}]) {
    assert.throws(() => configResendTest(env));
  }
  assert.equal(configResendTest(ENV).destino, 'delivered@resend.dev');
});

test('5D: destino restringido a prueba Resend o email de cuenta registrado', () => {
  assert.throws(() => configResendTest({...ENV, RESEND_TEST_TO:'candidato@empresa.com'}));
  assert.throws(() => configResendTest({...ENV, RESEND_TEST_TO:'foo@x.com,bar@x.com'}));
  assert.equal(configResendTest({...ENV, RESEND_TEST_TO:'mi-cuenta@example.com', RESEND_ACCOUNT_EMAIL:'mi-cuenta@example.com'}).destino, 'mi-cuenta@example.com');
});

test('5D: HTML utiliza solo datos ficticios; idempotencia estable por notificación', () => {
  const c = configResendTest(ENV);
  const x = prepararMensajePrueba(UUID1, 'entrevista', c);
  const y = prepararMensajePrueba(UUID1, 'entrevista', c);
  assert.deepEqual(x,y);
  assert.match(x.payload.html,/PRUEBA TÉCNICA/);
  assert.match(x.payload.html,/Candidato de demostración/);
  assert.match(x.payload.text,/Vacante de demostración/);
  assert.deepEqual(x.payload.to,['delivered@resend.dev']);
  assert.match(x.payload.subject,/\[PRUEBA TalentAI\]/);
  assert.throws(() => prepararMensajePrueba('no-uuid','entrevista',c));
});

test('5D: realiza POST HTTPS con clave idempotente y sin PII de candidato', async () => {
  let llamada;
  const respuesta = await enviarResendPrueba({
    idNotificacion:UUID1, evento:'postulacion_recibida', env:ENV,
    fetchImpl:async (url, options) => { llamada={url,options}; return {ok:true,status:200,json:async()=>({id:UUID2})}; },
  });
  assert.deepEqual(respuesta,{resultado:'aceptado_proveedor',codigo:'RESEND_ACCEPTED',idMensaje:UUID2});
  assert.equal(llamada.url,'https://api.resend.com/emails');
  assert.equal(llamada.options.headers['Idempotency-Key'], `talentai-5d-prueba-${UUID1}`);
  assert.equal(llamada.options.headers.Authorization, `Bearer ${ENV.RESEND_API_KEY}`);
  assert.equal(JSON.parse(llamada.options.body).to[0],'delivered@resend.dev');
  assert.equal(llamada.options.body.includes('candidate@personal.com'),false);
});

test('5D: 429 permite retry controlado, 401 obliga corrección, 500 y 409 quedan inciertos', async () => {
  for (const [status, esperado] of [[429,'fallo_transitorio'],[401,'fallo_permanente'],[500,'resultado_incierto'],[409,'resultado_incierto']]) {
    const r=await enviarResendPrueba({idNotificacion:UUID1,evento:'en_revision',env:ENV,
      fetchImpl:async()=>({ok:false,status})});
    assert.equal(r.resultado,esperado);
  }
});

test('5D: timeout, caída de red o respuesta sin id requieren revisión manual', async () => {
  const a=await enviarResendPrueba({idNotificacion:UUID1,evento:'entrevista',env:ENV,
    fetchImpl:async()=>{throw Error('network failure');}});
  const b=await enviarResendPrueba({idNotificacion:UUID1,evento:'entrevista',env:ENV,
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({})})});
  assert.equal(a.resultado,'resultado_incierto');
  assert.equal(b.resultado,'resultado_incierto');
});

test('5D: procesador valida configuración ANTES de tocar la cola', async () => {
  await assert.rejects(procesarUnaPrueba({env:{},repo:{reclamar:()=>{throw Error('BAD');}}}),/no está habilitado/);
});

test('5D: procesador reclama un único evento y registra aceptación (sin entregar)', async () => {
  const llamados=[];
  const resumen=await procesarUnaPrueba({env:ENV,
    repo:{reclamar:async()=>[{id_notificacion:UUID1,lease_token:UUID2,tipo_evento:'entrevista'}],
      finalizar:async(item,rs)=>{llamados.push(rs);return 'aceptado_proveedor';}},
    enviar:async()=>({resultado:'aceptado_proveedor',codigo:'RESEND_ACCEPTED',idMensaje:UUID2})});
  assert.deepEqual(resumen,{reclamadas:1,aceptadas:1,rechazadas:0,inciertas:0,sin_finalizar:0});
  assert.equal(llamados.length,1);
});

test('5D: procesador nunca vuelve a enviar cuando la finalización falla', async () => {
  let intentos=0;
  const resumen=await procesarUnaPrueba({env:ENV,
    repo:{reclamar:async()=>[{id_notificacion:UUID1,lease_token:UUID2,tipo_evento:'entrevista'}],
      finalizar:async()=>{throw Error('rpc error');}},
    enviar:async()=>{intentos++;return {resultado:'aceptado_proveedor',codigo:'RESEND_ACCEPTED',idMensaje:UUID2};}});
  assert.equal(intentos,1);
  assert.equal(resumen.sin_finalizar,1);
});

test('5D: SQL exige opt-in individual, exclusión de filas, lease y control manual de inciertos', () => {
  assert.match(sql,/prueba_resend_autorizada boolean NOT NULL DEFAULT false/);
  assert.match(sql,/WHERE n\.prueba_resend_autorizada=true/);
  assert.match(sql,/FOR UPDATE SKIP LOCKED/);
  assert.match(sql,/n\.lease_token=p_token AND n\.bloqueado_hasta>clock_timestamp\(\)/);
  assert.match(sql,/requiere_revision/);
  assert.match(sql,/NOT \(n\.estado='requiere_revision' AND n\.prueba_resend_autorizada=true\)/);
});

test('5D: RPC restringidas a service_role', () => {
  for (const fn of ['talentai_autorizar_prueba_resend','talentai_reclamar_notificaciones_resend_prueba','talentai_finalizar_notificacion_resend_prueba']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }
});

test('5D: rutas protegidas y UI hacen explícito que no hay entrega ni envío a candidatos', () => {
  assert.match(rutas,/router\.use\(verificarToken, adminOnly\)/);
  for (const accion of ['autorizar-prueba-resend','procesar-resend-prueba','configuracion-envio']) assert.ok(rutas.includes(accion));
  assert.match(html,/btn-procesar-resend-prueba/);
  assert.match(js,/prueba_resend_autorizada/);
  assert.match(js,/la entrega aún no está confirmada/i);
  assert.match(js,/nunca el correo del candidato/i);
});
