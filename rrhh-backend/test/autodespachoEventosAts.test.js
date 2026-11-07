'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'supabase/16c_autodespacho_eventos_ats_pruebas.sql'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/16c_verify_autodespacho_eventos_ats.sql'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../src/routes/notificaciones.routes.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'rrhh-frontend/notificaciones.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'rrhh-frontend/js/notificaciones.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'rrhh-frontend/css/notificaciones.css'), 'utf8');

function serverStub({configured=true, policyEnabled=false, dbError=null, rpcError=null}={}) {
  const handlers = new Map();
  const calls = [];
  const audits = [];
  const router = {use(...a){ calls.push(['middleware',...a]); },
    get(path,callback){handlers.set('GET '+path,callback);},
    post(path,callback){handlers.set('POST '+path,callback);} };
  const db = {
    from(name) {
      assert.equal(name, 'notificaciones_auto_ats_politica');
      return {select(cols) {
        assert.ok(cols.includes('habilitado'));
        return {eq(key,value) {assert.equal(key,'id');assert.equal(value,1);
          return {single: async() => ({data:dbError ? null : {
            habilitado:policyEnabled,habilitado_en:null,actualizado_en:null},error:dbError})};}};
      }};
    },
    rpc(name,args) {
      calls.push(['rpc',name,args]);
      return Promise.resolve({data:rpcError ? null : true,error:rpcError});
    }
  };
  const map = {
    express:{Router:()=>router},
    '../config/supabase':db,
    '../middlewares/authMiddleware':function auth(){},
    '../middlewares/adminOnly':function adminOnly(){},
    '../utils/supabaseRetry':{withSupabaseRetry: async(fn)=>fn(),createSupabaseError:e=>e},
    '../services/mailTemplates':{EVENTOS:{postulacion_recibida:{},en_revision:{},entrevista:{},contratado:{},descartado:{}},renderEmail:()=>({})},
    '../services/notificationProcessor':{procesarLote:async()=>({}),safeCount:n=>n},
    '../services/resendTestProcessor':{procesarUnaPrueba:async()=>({})},
    '../services/resendTestTransport':{configResendTest:()=>({})},
    '../services/resendAutoWorker':{configResendAuto:()=>{if(!configured)throw Error('configuración inválida');return {maxDiario:5};}},
    '../services/resendWebhookService':{configuracionWebhook:()=>({})},
    '../services/auditService':{registrarAuditoria:async(...args)=>{audits.push(args);}},
  };
  const module = {exports:{}};
  const factory = vm.runInNewContext('(function(require,module,exports,process){ '+route+'\n})');
  factory((name)=>{assert.ok(Object.hasOwn(map,name),'Módulo no esperado: '+name);return map[name];},module,module.exports,{env:{}});
  async function request(method,endpoint,body={}) {
    const fn=handlers.get(method+' '+endpoint);
    assert.ok(fn,'Falta ruta '+method+' '+endpoint);
    const res={statusCode:200,body:null,status(c){this.statusCode=c;return this;},json(data){this.body=data;return this;}};
    let err;
    await fn({body,usuario:{id:'c309e37a-cfa2-4de9-97c4-b68d0e0b0ef6'}},res,e=>{err=e;});
    if(err)throw err;
    return res;
  }
  return {request,calls,audits};
}

test('8A.2: política se instala desactivada y no actualiza registros históricos',()=>{
  assert.match(sql,/habilitado boolean NOT NULL DEFAULT false/);
  assert.match(sql,/VALUES \(1,false\) ON CONFLICT/);
  assert.doesNotMatch(sql,/UPDATE public\.notificaciones_email\s+SET\s+auto_resend_autorizado=true/i);
  assert.match(sql,/BEFORE INSERT ON public\.notificaciones_email/);
});

test('8A.2: sólo se arman eventos nuevos generados por ATS y no conciliaciones',()=>{
  assert.match(sql,/coalesce\(NEW\.datos->>'origen',''\) NOT IN \('creacion_aplicacion','cambio_estado'\)/);
  assert.match(sql,/NEW\.id_aplicacion IS NULL/);
  assert.match(sql,/NEW\.tipo_evento='postulacion_recibida'/);
  assert.match(sql,/NEW\.tipo_evento IN \('en_revision','entrevista','contratado','descartado'\)/);
  assert.match(sql,/NEW\.tipo_evento IN \('postulacion_recibida','en_revision','entrevista'\)/);
  assert.doesNotMatch(sql,/INSERT INTO public\.aplicaciones_ats/);
});

test('8A.2: Contratado y Descartado exigen aprobación previa a activar Resend',()=>{
  assert.match(sql,/BEFORE UPDATE OF datos,aprobado_por/);
  assert.match(sql,/NEW\.tipo_evento IN \('contratado','descartado'\)/);
  assert.match(sql,/OLD\.datos->>'aprobado_envio'='false'/);
  assert.match(sql,/NEW\.datos->>'aprobado_envio'='true'/);
  assert.match(sql,/NEW\.aprobado_por IS NOT NULL/);
  assert.match(sql,/NOT NEW\.auto_resend_autorizado/);
});

test('8A.2: activación rota versión; el apagado desarma pendientes sin tocar enviados',()=>{
  assert.match(sql,/version_actual=gen_random_uuid\(\)/);
  assert.match(sql,/NEW\.datos := jsonb_set\(NEW\.datos,'\{auto_ats_version\}'/);
  assert.match(sql,/n\.datos \? 'auto_ats_version'/);
  assert.match(sql,/n\.auto_resend_autorizado_por IS NULL/);
  assert.match(sql,/n\.estado IN \('pendiente','fallido'\)/);
  assert.match(sql,/n\.id_mensaje_proveedor IS NULL/);
  assert.match(sql,/p\.version_actual::text=n\.datos->>'auto_ats_version'/);
});

test('8A.2: reclamador conserva idempotencia, SKIP LOCKED y límites de Resend',()=>{
  for(const value of ['pg_try_advisory_xact_lock','FOR UPDATE SKIP LOCKED LIMIT 1','notificaciones_resend_auto_reservas','AT TIME ZONE \'UTC\'','RETURNING reserva.lease_token']){
    assert.ok(sql.includes(value),`Falta ${value}`);
  }
  assert.match(sql,/n\.ultimo_error='RESEND_RATE_LIMIT'/);
  assert.match(sql,/n\.id_mensaje_proveedor IS NULL/);
});

test('8A.2: envío manual 5D no reclama mensajes elegibles del trabajador 8A',()=>{
  const section=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.talentai_reclamar_notificaciones_resend_prueba('));
  assert.match(section,/AND n\.auto_resend_autorizado=false/);
  assert.match(section,/AND n\.id_mensaje_proveedor IS NULL/);
  assert.match(section,/n\.estado='procesando'/);
});

test('8A.2: permisos RLS y RPC siguen restringidos al backend',()=>{
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON public\.notificaciones_auto_ats_politica FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT SELECT ON public\.notificaciones_auto_ats_politica TO service_role/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.talentai_configurar_autodespacho_ats\(boolean,uuid\) FROM PUBLIC,anon,authenticated/);
  assert.match(route,/router\.use\(verificarToken, adminOnly\)/);
  for(const mark of ['01_POLICY','02_TRIGGERS','03_PERMISSIONS','04_EXISTING','05_GUARDS'])assert.ok(verify.includes(mark));
});

test('8A.2: panel consulta estado sin exponer secretos y muestra modo de prueba',async()=>{
  const api=serverStub({configured:true,policyEnabled:true});
  const r=await api.request('GET','/politica-ats');
  assert.equal(r.statusCode,200);
  assert.equal(r.body.habilitado,true);
  assert.equal(r.body.trabajador_habilitado,true);
  assert.equal(r.body.destino,'prueba_controlada');
  assert.deepEqual(Array.from(r.body.eventos_con_aprobacion),['contratado','descartado']);
  assert.ok(!JSON.stringify(r.body).includes('API_KEY'));
});

test('8A.2: rechaza activación cuando el trabajador de pruebas está apagado',async()=>{
  const api=serverStub({configured:false});
  const r=await api.request('POST','/politica-ats',{habilitado:true});
  assert.equal(r.statusCode,409);
  assert.equal(api.calls.filter(x=>x[0]==='rpc').length,0);
});

test('8A.2: valida tipo booleano y nunca envía autorizaciones por lote',async()=>{
  const api=serverStub();
  for(const input of ['true',1,{},null]){
    const r=await api.request('POST','/politica-ats',{habilitado:input});
    assert.equal(r.statusCode,400);
  }
  assert.equal(api.calls.filter(x=>x[0]==='rpc').length,0);
});

test('8A.2: habilitar/deshabilitar requiere administrador, llama una RPC y audita',async()=>{
  const api=serverStub();
  let r=await api.request('POST','/politica-ats',{habilitado:true});
  assert.equal(r.statusCode,200);
  r=await api.request('POST','/politica-ats',{habilitado:false});
  assert.equal(r.statusCode,200);
  assert.equal(api.calls.filter(x=>x[0]==='rpc').length,2);
  assert.equal(api.calls[1][1],'talentai_configurar_autodespacho_ats');
  assert.equal(api.calls[1][2].p_habilitado,true);
  assert.equal(api.calls[2][2].p_habilitado,false);
  assert.equal(api.audits.length,2);
});

test('8A.2: falla de Supabase no declara éxito ni activa el despacho',async()=>{
  const api=serverStub({dbError:{code:'PGRST205'},rpcError:{code:'42501'}});
  assert.equal((await api.request('GET','/politica-ats')).statusCode,503);
  assert.equal((await api.request('POST','/politica-ats',{habilitado:true})).statusCode,503);
  assert.equal(api.audits.length,0);
});

test('8A.2: interfaz global incorpora botón y confirmación sin eliminar acciones existentes',()=>{
  assert.match(html,/id="btn-politica-ats"/);
  assert.match(html,/id="estado-politica-ats"/);
  assert.match(css,/\.nc-policy\s*\{/);
  assert.match(ui,/cargarPoliticaATS\(\)/);
  assert.match(ui,/DialogService\.confirm\(mensaje/);
  assert.match(ui,/solicitar\(\s*['"]\/politica-ats['"]\s*,\s*['"]POST['"]\s*,\s*\{\s*habilitado\s*:\s*habilitar\s*\}\s*\)/);
  for(const fragment of ['autorizar-prueba-resend','autorizar-auto-resend','revocar-auto-resend'])assert.ok(ui.includes(fragment));
  assert.ok(ui.includes('No se enviará el historial'));
});
