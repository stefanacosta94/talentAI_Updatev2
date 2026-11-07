'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { procesarLote, safeCount, assertMockMode } = require('../src/services/notificationProcessor');

const raiz = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(raiz, 'supabase/12_notifications_processing_mock.sql'), 'utf8');
const rutas = fs.readFileSync(path.join(raiz, 'rrhh-backend/src/routes/notificaciones.routes.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'rrhh-frontend/notificaciones.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'rrhh-frontend/js/notificaciones.js'), 'utf8');
const ejemplo = { id_notificacion:'00000000-0000-4000-8000-000000000001', lease_token:'00000000-0000-4000-8000-000000000002', tipo_evento:'en_revision', nombre_candidato:'Prueba', destinatario_email:'test@example.com', titulo_vacante:'Vacante' };

test('5C: cantidades válidas y rechazo de límites inseguros', () => {
  assert.equal(safeCount('10'),10);
  for (const value of [0,-1,21,3.5,'xx',null]) assert.throws(() => safeCount(value));
});

test('5C: simula sin confirmar entrega, sin incrementar intentos reales', async () => {
  const llamadas = [];
  const r = await procesarLote({ limite:1, repo:{
    reclamar: async n => { assert.equal(n,1); return [ejemplo]; },
    finalizar: async (...x) => { llamadas.push(x); return 'pendiente'; },
  }, enviar: async () => ({ simulado:true, aceptadoPorProveedor:false, idMensaje:null }) });
  assert.deepEqual(r,{ reclamadas:1, simuladas:1, fallidas:0, sin_finalizar:0 });
  assert.deepEqual(llamadas[0].slice(2), ['simulado','MOCK_OK']);
});

test('5C: falla de plantilla queda registrada como diagnóstico limitado', async () => {
  let salida;
  const r=await procesarLote({repo:{
    reclamar:async () => [ejemplo],
    finalizar:async (...args) => { salida=args; },
  }, render: () => { throw new TypeError('Datos inválidos'); }});
  assert.equal(r.fallidas,1);
  assert.deepEqual(salida.slice(2),['fallo_transitorio','TEMPLATE_ERROR']);
});

test('5C: no confirma ni procesa con modo real habilitado por error', async () => {
  const antes=process.env.EMAIL_MODE;process.env.EMAIL_MODE='smtp';
  try {
    assert.throws(assertMockMode,/solo admite EMAIL_MODE=mock/);
    await assert.rejects(procesarLote({repo:{ reclamar: () => {throw Error('NO DEBE RECLAMAR');}}}),/solo admite/);
  } finally {
    if (antes === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE=antes;
  }
});

test('5C: respuesta de transporte que no sea simulada no se marca como enviada', async () => {
  let resultado;
  await procesarLote({repo:{reclamar:async()=>[ejemplo],finalizar:async(...x)=>{resultado=x[2];}},
    enviar:async()=>({simulado:false,aceptadoPorProveedor:true})});
  assert.equal(resultado,'fallo_transitorio');
});

test('5C: fallos de finalización no se vuelven a confirmar ciegamente', async () => {
  let finalizaciones=0;
  const resumen=await procesarLote({repo:{reclamar:async()=>[ejemplo],finalizar:async()=>{finalizaciones++;throw Error('lease expiró');}},
    enviar:async()=>({simulado:true,aceptadoPorProveedor:false})});
  assert.equal(finalizaciones,1);
  assert.equal(resumen.sin_finalizar,1);
});

test('5C: SQL reclama filas concurrentemente y valida lease antes de finalizar', () => {
  assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(sql, /n\.lease_token=p_token AND n\.estado='procesando'/);
  assert.match(sql, /bloqueado_hasta > clock_timestamp\(\)/);
  assert.match(sql, /requiere_revision/);
  assert.match(sql, /'simulado','fallo_transitorio','fallo_permanente'/);
  assert.doesNotMatch(sql, /'aceptado_proveedor'\s*\)/);
});

test('5C: aprobación y conciliación limitadas, sin backfill masivo', () => {
  assert.match(sql, /p_actor uuid/);
  assert.match(sql, /WHERE id=p_actor AND rol='admin'/);
  assert.match(sql, /id_aplicacion_desde/);
  assert.match(sql, /'conciliacion_5c'/);
  assert.match(sql, /'requiere_aprobacion',true,'aprobado_envio',false/);
  assert.match(sql, /ON CONFLICT \(clave_idempotencia\) DO NOTHING/);
});

test('5C: RLS, revocaciones y RPC restringidas a service_role', () => {
  for (const tabla of ['notificaciones_email_intentos','notificaciones_configuracion']) {
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${tabla} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql,new RegExp(`REVOKE ALL ON TABLE public\\.${tabla} FROM PUBLIC, anon, authenticated`));
  }
  for (const fn of ['talentai_reclamar_notificaciones_mock','talentai_finalizar_notificacion_mock','talentai_aprobar_notificacion','talentai_cancelar_notificacion','talentai_reprogramar_notificacion','talentai_conciliar_recepciones']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }
});

test('5C: las rutas de acción siguen bajo JWT y adminOnly', () => {
  assert.match(rutas,/router\.use\(verificarToken, adminOnly\)/);
  for(const route of ['procesar-simulacion','conciliar-recepciones','aprobar','cancelar','reprogramar']) assert.ok(rutas.includes(route));
  assert.doesNotMatch(rutas,/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
});

test('5C: UI conserva simulación, conciliación, historial y aviso de pruebas', () => {
  for(const id of ['btn-procesar-simulacion','btn-conciliar-recepciones','dialog-intentos']) assert.ok(html.includes(id));
  assert.match(html,/el envío a candidatos reales permanece desactivado/i);
  assert.match(js,/NotificationService\.info/);
  assert.match(js,/accionesDisponibles/);
  assert.match(js,/\/procesar-simulacion/);
});
