"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararMensajePrueba } = require('../src/services/resendTestTransport');
const { createResendTestRepository, procesarUnaPrueba } = require('../src/services/resendTestProcessor');
const fs = require('node:fs');
const path = require('node:path');
const id = '1f7338e8-a1ed-46e2-b82b-d42daea43ddd';
const lease = '84aaafc2-dbc5-4b3e-aadd-5ec071f6b343';
const env = { EMAIL_MODE:'resend_test',RESEND_TEST_ENABLED:'true',RESEND_API_KEY:'re_clave_falsa',RESEND_TEST_TO:'delivered@resend.dev' };
const fila = {id_notificacion:id,tipo_evento:'en_revision',nombre_candidato:'Ana <script>ejemplo</script>',titulo_vacante:'Gerencia y <Tecnología>',id_aplicacion:42};
test('C06: el mensaje personaliza y escapa HTML sin textos de demostración',()=>{
  const v = prepararMensajePrueba(id,'en_revision',{destino:'delivered@resend.dev',remitente:'TalentAI <onboarding@resend.dev>'},fila);
  assert.match(v.payload.html,/Ana &lt;script&gt;ejemplo&lt;\/script&gt;/);
  assert.match(v.payload.html,/Gerencia y &lt;Tecnología&gt;/);
  assert.doesNotMatch(v.payload.html,/PRUEBA|demostración/i);
  assert.deepEqual(v.payload.to,['delivered@resend.dev']);
  assert.match(v.payload.html,/TA-000042/);
  assert.match(v.payload.html,/¿Qué sigue\?/);
});
test('C06: si falta la instantánea no se invoca el transporte externo',async()=>{
  let llamados=0, respuesta;
  const resumen=await procesarUnaPrueba({env, repo:{
    reclamar:async()=>[{id_notificacion:id,lease_token:lease,tipo_evento:'en_revision'}],
    obtenerDatos:async()=>{throw new Error('Sin datos');},
    finalizar:async(_,rs)=>{respuesta=rs;return 'requiere_revision';}
  },enviar:async()=>{llamados++;}});
  assert.equal(llamados,0);assert.equal(respuesta.resultado,'resultado_incierto');assert.equal(resumen.inciertas,1);
});
test('C06: datos de la cola se obtienen del registro confirmado y no del frontend',async()=>{
  const llamadas=[];
  const db={from:(tabla)=>{assert.equal(tabla,'notificaciones_email');return {
    select:(cols)=>({eq:(col,value)=>({single:async()=>{llamadas.push({col,value,cols});return {data:fila,error:null};}})})
  };},rpc:async()=>({data:[],error:null})};
  const repo=createResendTestRepository(db);assert.deepEqual(await repo.obtenerDatos(fila),fila);
  assert.equal(llamadas[0].col,'id_notificacion');assert.equal(llamadas[0].value,id);
});

test('C06: el trabajador automático reutiliza el repositorio con detalle',()=>{
  const worker = fs.readFileSync(path.join(__dirname,'../src/services/resendAutoWorker.js'),'utf8');
  assert.match(worker,/obtenerDatos:\s*base\.obtenerDatos/);
});
