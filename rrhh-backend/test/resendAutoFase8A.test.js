'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'supabase/16_resend_auto_test.sql'), 'utf8');
const verificar = fs.readFileSync(path.join(root, 'supabase/16_verify_resend_auto_test.sql'), 'utf8');
const rutas = fs.readFileSync(path.join(__dirname, '../src/routes/notificaciones.routes.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'rrhh-frontend/js/notificaciones.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'rrhh-frontend/conocimiento.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../src/services/resendAutoWorker.js'), 'utf8');
const moduleStub = { exports: {} };
vm.runInNewContext(source, {
  module: moduleStub, exports: moduleStub.exports,
  require(name) {
    if (name === '../config/supabase') return {};
    if (name === './resendTestTransport') return {configResendTest(env) {
      if (env.EMAIL_MODE !== 'resend_test' || env.RESEND_TEST_ENABLED !== 'true' || !env.RESEND_API_KEY || !env.RESEND_TEST_TO) {
        throw Error('configuracion incompleta');
      }
      if (env.RESEND_TEST_TO !== env.RESEND_ACCOUNT_EMAIL) throw Error('destinatario no autorizado');
      return {destino: env.RESEND_TEST_TO};
    }};
    if (name === './resendTestProcessor') return {
      createResendTestRepository(db) {
        return { finalizar: async (...args) => db.finalizar(...args) };
      },
      procesarUnaPrueba: async () => ({}),
    };
    throw Error(`Import inesperado: ${name}`);
  },
  console, process, setTimeout, setInterval, clearTimeout, clearInterval,
}, {filename:'resendAutoWorker.js'});
const worker = moduleStub.exports;
const ENV = Object.freeze({
  EMAIL_MODE:'resend_test', RESEND_TEST_ENABLED:'true', RESEND_API_KEY:'re_test_key_123456',
  RESEND_TEST_TO:'pruebas@example.com', RESEND_ACCOUNT_EMAIL:'pruebas@example.com',
  RESEND_AUTO_ENABLED:'true', RESEND_AUTO_POLL_MS:'60000', RESEND_AUTO_MAX_PER_DAY:'5',
});

// Pruebas sin API Key real, llamadas HTTP ni base de datos externa.
test('8A: automatización deshabilitada por defecto', async () => {
  assert.throws(()=>worker.configResendAuto({}), /deshabilitado/i);
  assert.throws(()=>worker.configResendAuto({...ENV, RESEND_AUTO_ENABLED:'false'}), /deshabilitado/i);
  let llamadas=0;
  await assert.rejects(worker.procesarCicloAutomatico({env:{},enviarUna:async()=>{llamadas++;}}));
  assert.equal(llamadas,0);
});

test('8A: requiere modo Resend de prueba, API Key y destino controlado antes de reclamar', () => {
  assert.throws(()=>worker.configResendAuto({...ENV, EMAIL_MODE:'mock'}));
  assert.throws(()=>worker.configResendAuto({...ENV, RESEND_TEST_TO:'ajeno@example.com'}));
  assert.throws(()=>worker.configResendAuto({...ENV, RESEND_API_KEY:''}));
  assert.equal(worker.configResendAuto(ENV).maxDiario,5);
});

test('8A: tamaño de cuota y período de sondeo tienen límites estrictos', () => {
  for (const num of ['0','21','-4','nope','2.5']) assert.throws(()=>worker.configResendAuto({...ENV,RESEND_AUTO_MAX_PER_DAY:num}));
  assert.throws(()=>worker.configResendAuto({...ENV,RESEND_AUTO_POLL_MS:'1000'}));
  assert.equal(worker.enteroControlado(undefined,5,1,20),5);
  assert.equal(worker.configResendAuto({...ENV,RESEND_AUTO_MAX_PER_DAY:'2',RESEND_AUTO_POLL_MS:'30000'}).intervaloMs,30000);
});

test('8A: el ciclo usa RPC de cola exclusiva y reutiliza la finalización de Fase 5D', async () => {
  const llamadas=[];
  const db={rpc:async (nombre,args)=>{llamadas.push([nombre,args]);return {data:[],error:null};},finalizar:async()=>{}};
  let invocaciones=0;
  await worker.procesarCicloAutomatico({env:ENV,db,enviarUna:async({repo,env})=>{
    invocaciones++;
    assert.equal(env.RESEND_TEST_TO,ENV.RESEND_ACCOUNT_EMAIL);
    assert.deepEqual(await repo.reclamar(),[]);
    assert.equal(typeof repo.finalizar,'function');
    return {reclamadas:0};
  }});
  assert.equal(invocaciones,1);
  assert.equal(llamadas[0][0],'talentai_reclamar_notificaciones_resend_auto');
  assert.equal(llamadas[0][1].p_max_diario,5);
});

test('8A: errores de reserva evitan llamadas externas', async () => {
  const db={rpc:async()=>({error:{code:'XX',message:'PII PRIVADA'}}),finalizar:async()=>{}};
  await assert.rejects(worker.procesarCicloAutomatico({env:ENV,db,
    enviarUna:async({repo})=>repo.reclamar()}),/reservar una notificación de prueba/);
});

test('8A: trabajador no arranca sin habilitación y no crea temporizadores', () => {
  let timers=0;
  const result=worker.iniciarDespachadorAutomatico({env:{},programarIntervalo:()=>{timers++;},programarInicio:()=>{timers++;},logger:{info(){},warn(){}}});
  assert.equal(result,null);assert.equal(timers,0);
});

test('8A: trabajador procesa una sola vez durante ciclos solapados y se puede detener', async () => {
  let work=0, desbloquear;
  const espera=new Promise(resolve=>{desbloquear=resolve;});
  const fn=async()=>{work++;await espera;return {reclamadas:1,aceptadas:1,rechazadas:0,inciertas:0,sin_finalizar:0};};
  let intervalo, inicio, cancelados=0;
  const logs=[];
  const w=worker.iniciarDespachadorAutomatico({env:ENV,ejecutar:fn,
    programarIntervalo:(cb,n)=>{intervalo=cb;assert.equal(n,60000);return {};},
    programarInicio:(cb)=>{inicio=cb;return {};},
    cancelarIntervalo:()=>{cancelados++;},cancelarInicio:()=>{cancelados++;},
    logger:{info:(...args)=>logs.push(args),warn:()=>{throw Error('no warn');}}});
  const a=w.tick(); const b=w.tick(); desbloquear(); await Promise.all([a,b]);
  assert.equal(work,1);assert.equal(typeof inicio,'function');assert.equal(typeof intervalo,'function');
  assert.ok(logs.some(v=>String(v[0]).includes('Trabajador habilitado')));
  w.detener();await w.tick();assert.equal(work,1);assert.equal(cancelados,2);
});

test('8A: errores del trabajador se registran sin detalles sensibles ni romper el ciclo', async () => {
  const logs=[];
  const w=worker.iniciarDespachadorAutomatico({env:ENV,ejecutar:async()=>{throw Error('re_secret_token y PII');},
    programarInicio:()=>({}),programarIntervalo:()=>({}),cancelarInicio:()=>{},cancelarIntervalo:()=>{},
    logger:{info:()=>{},warn:(...args)=>logs.push(args)}});
  await w.tick();w.detener();
  assert.ok(logs.length);assert.ok(!JSON.stringify(logs).includes('re_secret_token'));
});

test('8A: SQL exige NUEVO opt-in administrativo sin heredar la autorización 5D', () => {
  assert.match(sql,/auto_resend_autorizado boolean NOT NULL DEFAULT false/);
  assert.match(sql,/n\.prueba_resend_autorizada=true/);
  assert.match(sql,/n\.auto_resend_autorizado=false/);
  assert.match(sql,/n\.datos->>'aprobado_envio'='true'/);
  assert.doesNotMatch(sql,/UPDATE public\.notificaciones_email SET auto_resend_autorizado=true\s*;/);
  assert.match(sql,/n\.estado='pendiente'/);
});

test('8A: SQL reclama con exclusión mutua, lease y tope diario en UTC', () => {
  assert.match(sql,/pg_try_advisory_xact_lock/);
  assert.match(sql,/FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.match(sql,/p_max_diario NOT BETWEEN 1 AND 20/);
  assert.match(sql,/AT TIME ZONE 'UTC'/);
  assert.match(sql,/notificaciones_resend_auto_reservas/);
  assert.match(sql,/bloqueado_hasta=clock_timestamp\(\)\+interval '2 minutes'/);
  assert.match(sql,/ultimo_error='RESEND_RATE_LIMIT'/);
  assert.match(sql,/estado='requiere_revision'/);
  assert.match(sql,/RETURNING\s+(?:[a-z_]+\.)?lease_token/i); // SQL 16b: alias explícito evita ambigüedad 42702
});

test('8A: RPC y tabla son privados; el servicio usa la misma idempotencia 5D', () => {
  for (const name of ['talentai_autorizar_auto_resend','talentai_revocar_auto_resend','talentai_reclamar_notificaciones_resend_auto']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
  }
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON public\.notificaciones_resend_auto_reservas FROM PUBLIC, anon, authenticated/);
  assert.match(source,/createResendTestRepository/);
  assert.match(source,/procesarUnaPrueba/);
});

test('8A: rutas exigen admin y UI permite autorización y revocación por fila', () => {
  assert.match(rutas,/router\.use\(verificarToken, adminOnly\)/);
  for (const fragment of ['autorizar-auto-resend','revocar-auto-resend','configResendAuto','auto_resend_autorizado']) assert.ok(rutas.includes(fragment));
  for (const fragment of ['autorizar-auto-resend','revocar-auto-resend','Activar automático (prueba)']) assert.ok(frontend.includes(fragment));
  assert.match(index,/iniciarDespachadorAutomatico\(\)/);
  assert.match(docs,/Supabase pgvector/);
  assert.doesNotMatch(docs,/pendiente de implementación/i);
  for (const fragment of ['01_COLUMNS','02_FUNCTIONS','03_SECURITY','04_QUEUE','05_RESERVATIONS','06_INTEGRITY']) assert.ok(verificar.includes(fragment));
});
