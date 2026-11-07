'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const root = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'supabase/17_resend_webhooks_delivery.sql'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/17_verify_resend_webhooks.sql'), 'utf8');
const index = fs.readFileSync(path.join(root, 'rrhh-backend/index.js'), 'utf8');
const rutaAdmin = fs.readFileSync(path.join(root, 'rrhh-backend/src/routes/notificaciones.routes.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'rrhh-frontend/js/notificaciones.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'rrhh-frontend/notificaciones.html'), 'utf8');
const {
  WebhookError, configuracionWebhook, verificarFirmaWebhook, extraerEventoSeguro,
  procesarWebhookFirmado, crearRepositorioWebhook,
} = require('../src/services/resendWebhookService');

const key = Buffer.alloc(32, 71);
const env = { RESEND_WEBHOOKS_ENABLED: 'true', RESEND_WEBHOOK_SECRET: 'whsec_' + key.toString('base64') };
const eventId = 'msg_1pQx9nW20tLLr4ww';
const uuid = '6d103fa0-62ea-48d2-a674-e91d8d0746de';
const now = Date.parse('2026-11-07T06:00:00.000Z');
function payload(tipo='email.delivered', emailId=uuid) {
  return Buffer.from(JSON.stringify({ type: tipo, created_at:'2026-11-07T05:59:00.000Z',
    data: { email_id: emailId, from:'secreto@example.org', to:['privado@example.org'], subject:'NO GUARDAR' } }), 'utf8');
}
function sign(body = payload(), id = eventId, t = Math.floor(now/1000)) {
  const sig=crypto.createHmac('sha256',key).update(`${id}.${t}.`).update(body).digest('base64');
  return { 'svix-id':id,'svix-timestamp':String(t),'svix-signature':'v1,'+sig };
}
function throwsCode(run, code) {
  assert.throws(run, error => error instanceof WebhookError && error.code === code);
}

test('8B: el webhook está apagado por defecto y exige firma secreta distinta a API Key', () => {
  throwsCode(() => configuracionWebhook({}), 'DISABLED');
  throwsCode(() => configuracionWebhook({ RESEND_WEBHOOKS_ENABLED:'true' }), 'SECRET_INVALID');
  throwsCode(() => configuracionWebhook({ RESEND_WEBHOOKS_ENABLED:'true', RESEND_WEBHOOK_SECRET:'re_abc' }), 'SECRET_INVALID');
  assert.equal(configuracionWebhook(env).key.length, 32);
});

test('8B: acepta la firma Svix válida en el cuerpo crudo y múltiples firmas de rotación', () => {
  const body = payload();
  assert.equal(verificarFirmaWebhook({body,headers:sign(body),env,ahoraMs:now}),eventId);
  const multi=sign(body); multi['svix-signature']='v1,'+Buffer.alloc(32, 3).toString('base64')+' '+multi['svix-signature'];
  assert.equal(verificarFirmaWebhook({body,headers:multi,env,ahoraMs:now}),eventId);
});

test('8B: altera un byte y la firma no pasa, incluso cuando el JSON sigue siendo válido', () => {
  const body=payload();
  const alterado=Buffer.from(body.toString().replace('NO GUARDAR','GUARDAR NO'));
  throwsCode(() => verificarFirmaWebhook({body:alterado,headers:sign(body),env,ahoraMs:now}), 'SIGNATURE_INVALID');
});

test('8B: previene repetición con timestamp antiguo o en el futuro', () => {
  for (const t of [Math.floor(now/1000)-301,Math.floor(now/1000)+301])
    throwsCode(() => verificarFirmaWebhook({body:payload(),headers:sign(payload(),eventId,t),env,ahoraMs:now}), 'TIMESTAMP_INVALID');
  assert.equal(verificarFirmaWebhook({body:payload(),headers:sign(payload(),eventId,Math.floor(now/1000)-300),env,ahoraMs:now}),eventId);
});

test('8B: rechaza cabeceras vacías, sin id, firmas falsas y cuerpo inválido', () => {
  throwsCode(() => verificarFirmaWebhook({body:payload(),headers:{},env,ahoraMs:now}), 'HEADERS_INVALID');
  const changed={...sign(), 'svix-id':'bad'};
  throwsCode(() => verificarFirmaWebhook({body:payload(),headers:changed,env,ahoraMs:now}), 'HEADERS_INVALID');
  const changedSig={...sign(), 'svix-signature':'v1,AAAA'};
  throwsCode(() => verificarFirmaWebhook({body:payload(),headers:changedSig,env,ahoraMs:now}), 'SIGNATURE_INVALID');
  throwsCode(() => verificarFirmaWebhook({body:Buffer.from('{}'),headers:sign(),env,ahoraMs:now}), 'SIGNATURE_INVALID');
  throwsCode(() => verificarFirmaWebhook({body:Buffer.from(''),headers:sign(),env,ahoraMs:now}), 'BODY_INVALID');
});

test('8B: valida event type, email_id y fecha sin aceptar payload malformado', () => {
  throwsCode(() => extraerEventoSeguro(Buffer.from('{oops'), eventId),'JSON_INVALID');
  throwsCode(() => extraerEventoSeguro(Buffer.from('[]'),eventId),'EVENT_INVALID');
  throwsCode(() => extraerEventoSeguro(payload('email.bounced','abc'),eventId),'EVENT_FIELDS_INVALID');
  assert.equal(extraerEventoSeguro(payload('contact.created'),eventId),null);
});

test('8B: solo retorna metadatos mínimos, sin filtrar PII a Supabase', () => {
  const evento=extraerEventoSeguro(payload(),eventId);
  assert.deepEqual(evento,{idEvento:eventId,idMensaje:uuid,tipo:'email.delivered',ocurridoEn:'2026-11-07T05:59:00.000Z'});
  assert.ok(!JSON.stringify(evento).includes('privado@example.org'));
  assert.ok(!JSON.stringify(evento).includes('NO GUARDAR'));
});

test('8B: envía solo datos verificados al RPC y reconoce persistencia/duplicado', async () => {
  const llamados=[];
  const repo=crearRepositorioWebhook({rpc:async(nombre,args)=>{llamados.push([nombre,args]);return {data:'duplicado',error:null};}});
  const r=await procesarWebhookFirmado({body:payload(),headers:sign(),env,repo,ahoraMs:now});
  assert.equal(r.resultado,'duplicado');
  assert.equal(llamados[0][0],'talentai_registrar_webhook_resend');
  assert.deepEqual(llamados[0][1],{
    p_evento_id:eventId,p_id_mensaje:uuid,p_tipo:'email.delivered',p_ocurrido_en:'2026-11-07T05:59:00.000Z',
  });
});

test('8B: eventos ajenos no llaman a Supabase ni generan estados', async () => {
  let llamadas=0;
  const body=payload('email.opened');
  const r=await procesarWebhookFirmado({body,headers:sign(body),env,repo:{registrar:async()=>{llamadas++;}},ahoraMs:now});
  assert.equal(r.resultado,'ignorado'); assert.equal(llamadas,0);
});

test('8B: firma incorrecta jamás llama al repositorio', async () => {
  let llamadas=0;
  await assert.rejects(procesarWebhookFirmado({body:payload(),headers:{...sign(),'svix-signature':'v1,xxx'},
    env,repo:{registrar:async()=>{llamadas++;}},ahoraMs:now}),error => error.code==='SIGNATURE_INVALID');
  assert.equal(llamadas,0);
});

test('8B: errores de Supabase no confirman recepción ni generan reintento de correo', async () => {
  const repo=crearRepositorioWebhook({rpc:async()=>({data:null,error:{code:'PGRST202',message:'sensible'}})});
  await assert.rejects(procesarWebhookFirmado({body:payload(),headers:sign(),env,repo,ahoraMs:now}),
    error => error.code==='PERSISTENCE_ERROR' && error.status===503 && !error.message.includes('sensible'));
});

test('8B: guarda un solo evento por svix-id, sin PII y protegido con RLS', () => {
  for(const needle of [
    'id_evento varchar(128) PRIMARY KEY','ON CONFLICT (id_evento) DO NOTHING',
    'GET DIAGNOSTICS v_insertado = ROW_COUNT','ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE public.notificaciones_resend_webhook_eventos FROM PUBLIC,anon,authenticated',
    'GRANT SELECT ON TABLE public.notificaciones_resend_webhook_eventos TO service_role',
    'p_tipo NOT IN',"RETURN 'duplicado'",
  ]) assert.ok(sql.includes(needle),`Falta ${needle}`);
  assert.doesNotMatch(sql,/\b(payload|destinatario_email|nombre_candidato|asunto|subject)\s+(?:jsonb|text|varchar)/i);
});

test('8B: la entrega no altera el estado del despacho, reintentos o idempotencia', () => {
  assert.match(sql,/entrega_estado=v_nuevo/);
  assert.match(sql,/n\.estado='aceptado_proveedor'/);
  const section=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.talentai_aplicar_evento_webhook_resend('),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.talentai_registrar_webhook_resend('));
  const soloSet=section.slice(section.indexOf('UPDATE public.notificaciones_email n SET'), section.indexOf('WHERE n.id_notificacion=v_id'));
  assert.doesNotMatch(soloSet,/\b(estado|intentos|id_mensaje_proveedor|lease_token)\s*=/i);
  assert.match(section,/AND NOT \(n\.entrega_estado IN \('rebotado','reclamo','suprimido','fallo_entrega'\)/);
  assert.match(section,/v_evento\.ocurrido_en > n\.entrega_evento_en/);
});

test('8B: el evento temprano se aplica al confirmar ID y existe conciliación manual', () => {
  assert.match(sql,/AFTER UPDATE OF estado,id_mensaje_proveedor ON public\.notificaciones_email/);
  assert.match(sql,/e\.procesado=false/);
  assert.match(sql,/public\.talentai_conciliar_webhooks_resend\(p_limite integer DEFAULT 50\)/);
  assert.match(sql,/PERFORM public\.talentai_aplicar_evento_webhook_resend/);
});

test('8B: política y webhooks siguen independientes; permisos de RPC solo service_role', () => {
  for(const needle of ['01_PERMISOS','02_TRIGGERS','03_ESTADO','04_COLUMNAS',
    'anon_registrar','service_role_registrar','anon_conciliar']) assert.ok(verify.includes(needle));
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.talentai_registrar_webhook_resend.*FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.talentai_registrar_webhook_resend.*TO service_role/);
  assert.doesNotMatch(sql,/UPDATE public\.notificaciones_auto_ats_politica/);
});

test('8B: raw HTTP se monta ANTES del parser JSON con límite y sin bypass de firma', () => {
  // El orden y la configuración importan; el estilo de comillas del archivo no.
  const raw=index.search(/express\.raw\(\{\s*type:\s*["']application\/json["']\s*,\s*limit:\s*["']64kb["']\s*\}\)/);
  const json=index.search(/app\.use\(express\.json\(\{\s*limit:\s*["']1mb["']\s*\}\)\);/);
  assert.ok(raw>=0 && raw<json);
  assert.match(index,/webhookLimiter/);
  assert.match(index,/app\.use\(\s*["']\/api\/webhooks\/resend["']/);
});

test('8B: administración y UI muestran aceptación vs entrega/rebote, sin compartir credenciales', () => {
  assert.match(rutaAdmin,/router\.use\(verificarToken, adminOnly\)/);
  assert.match(rutaAdmin,/router\.get\(['"]\/:id\/eventos-entrega['"]/);
  assert.match(rutaAdmin,/router\.post\(['"]\/conciliar-webhooks['"]/);
  assert.match(ui,/Entrega aún no confirmada/);
  assert.match(ui,/Entrega confirmada/);
  assert.match(ui,/Rebotado/);
  assert.match(ui,/textContent/);
  assert.doesNotMatch(ui,/\.innerHTML\s*=/);
  assert.match(html,/kpi-entregados/);
  assert.match(html,/kpi-rebotados/);
});

function crearRouterTest({ ahora = Date.now(), response='aplicado' }={}) {
  const source=fs.readFileSync(path.join(root,'rrhh-backend/src/routes/resendWebhook.routes.js'),'utf8');
  let called=[];
  const mockRepo={ registrar:async e=>{ called.push(e); return response; } };
  const r= {exports:{}};
  const routerFactory=vm.runInNewContext('(function(require,module,exports){'+source+'\n})');
  routerFactory(name=>{
    if(name==='express') return express;
    if(name==='../services/resendWebhookService') return {
      WebhookError, procesarWebhookFirmado:({body,headers})=>procesarWebhookFirmado({body,headers,env,repo:mockRepo,ahoraMs:ahora}),
    };
    throw Error('unexpected require');
  },r,r.exports);
  const app=express();
  app.use('/api/webhooks/resend',express.raw({type:'application/json',limit:'64kb'}),r.exports);
  const server=app.listen(0,'127.0.0.1');
  return { server,called, async base(){if(!server.listening) await new Promise(resolve=>server.once('listening',resolve)); return `http://127.0.0.1:${server.address().port}/api/webhooks/resend`;},
    close:()=>new Promise(done=>server.close(done)), };
}

test('8B: Express recibe bytes JSON crudos, valida HMAC y responde 200 sin datos internos', async () => {
  const svc=crearRouterTest({ahora:now});
  try {
    const body=payload();
    const r=await fetch(await svc.base(),{method:'POST',headers:{'Content-Type':'application/json',...sign(body)},body});
    assert.equal(r.status,200); assert.deepEqual(await r.json(),{recibido:true});
    assert.equal(svc.called.length,1);
  } finally { await svc.close(); }
});

test('8B: HTTP rechaza firma inválida con 400 sin guardar nada', async () => {
  const svc=crearRouterTest({ahora:now});
  try {
    const body=payload();
    const r=await fetch(await svc.base(),{method:'POST',headers:{'Content-Type':'application/json',...sign(body),'svix-signature':'v1,invalid'},body});
    assert.equal(r.status,400); assert.deepEqual(await r.json(),{recibido:false});
    assert.equal(svc.called.length,0);
  } finally { await svc.close(); }
});

test('8B: HTTP rechaza content-type no JSON antes de acceder a datos', async () => {
  const svc=crearRouterTest({ahora:now});
  try {
    const body=payload();
    const r=await fetch(await svc.base(),{method:'POST',headers:{'Content-Type':'text/plain',...sign(body)},body});
    assert.equal(r.status,400); assert.equal(svc.called.length,0);
  } finally { await svc.close(); }
});

test('8B: proxy de túnel expone únicamente POST al webhook y oculta resto del backend', async () => {
  const http=require('node:http');
  const { crearProxyWebhook }=require('../scripts/webhook-only-proxy');
  const backend=http.createServer((req,res)=>{
    assert.equal(req.url,'/api/webhooks/resend');
    assert.equal(req.method,'POST');
    res.writeHead(200,{'content-type':'application/json'});res.end('{"recibido":true}');
  });
  await new Promise(done=>backend.listen(0,'127.0.0.1',done));
  const proxy=crearProxyWebhook({ puerto:0,destino:backend.address().port, logger:{info:()=>{}} });
  try {
    await new Promise(resolve=>proxy.listening ? resolve() : proxy.once('listening',resolve));
    const base=`http://127.0.0.1:${proxy.address().port}`;
    const no=await fetch(base+'/api/admin/notificaciones');
    assert.equal(no.status,404);
    const no2=await fetch(base+'/api/webhooks/resend');
    assert.equal(no2.status,404);
    const si=await fetch(base+'/api/webhooks/resend',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(si.status,200); assert.deepEqual(await si.json(),{recibido:true});
  } finally {
    await new Promise(done=>proxy.close(done));
    await new Promise(done=>backend.close(done));
  }
});
