'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base=path.join(__dirname,'..');
function appMock(resultForCall) {
  const routes=new Map(), calls=[], audits=[];
  const router={
    use() {},
    get(url,...fns) {routes.set('GET '+url,fns.at(-1));},
    put(url,...fns) {routes.set('PUT '+url,fns.at(-1));},
    post(url,...fns) {routes.set('POST '+url,fns.at(-1));},
    delete(url,...fns) {routes.set('DELETE '+url,fns.at(-1));},
  };
  const db={from(table) {
    const call={table,operation:'read'};calls.push(call);
    const b={
      select(columns,options) {call.columns=columns;call.options=options;return this;},
      insert(data) {call.operation='insert';call.data=data;return this;},
      update(data) {call.operation='update';call.data=data;return this;},
      delete() {call.operation='delete';return this;},
      order(column,options) {call.order=column;call.orderOptions=options;return this;},
      eq(column,value) {call.filter=[column,value];return this;},
      single() {return Promise.resolve(resultForCall(call));},
      maybeSingle() {return Promise.resolve(resultForCall(call));},
      then(resolve,reject) {return Promise.resolve(resultForCall(call)).then(resolve,reject);},
    };return b;
  }};
  const source=fs.readFileSync(path.join(base,'src/routes/admin.routes.js'),'utf8');
  const module={exports:{}};
  const run=vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{console,Buffer,setTimeout});
  const multer=Object.assign(()=>({single:()=>()=>{}}),{memoryStorage:()=>({})});
  run(name=>{
    const mocked={
      'express':{Router:()=>router},'bcrypt':{},'multer':multer,
      '../config/supabase':db,
      '../middlewares/authMiddleware':()=>{},'../middlewares/adminOnly':()=>{},
      '../services/auditService':{registrarAuditoria:async (...args)=>audits.push(args)},
      '../services/atsService':{},'../services/atsReadService':{},
      '../services/storageService':{},'../constants/ats':{ATS_APPLICATION_STATES:[]},
      '../utils/supabaseRetry':{withSupabaseRetry:fn=>fn(),createSupabaseError:err=>err},
      '../security/securityUtils':require('../src/security/securityUtils'),
      '../services/orgValidation':require('../src/services/orgValidation'),
      '../services/adminCatalogValidation':require('../src/services/adminCatalogValidation'),
    };
    if (!Object.hasOwn(mocked,name))throw new Error('Mock missing '+name);
    return mocked[name];
  },module,module.exports);
  async function invoke(method,url,body={},params={},query={}) {
    const route=routes.get(method+' '+url);assert.ok(route,'route '+method+' '+url);
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(obj){this.body=obj;return this;}};
    let err;
    await route({body,params,query,usuario:{id:'user-admin'}},res,e=>{err=e;});
    if(err)throw err;
    return res;
  }
  return {invoke,calls,audits};
}
test('C05 cargo: permite crear con departamento validado',async()=>{
  const app=appMock(c=>({data:{id_cargo:12,...c.data[0]},error:null}));
  const res=await app.invoke('POST','/cargos',{nombre:' Auditor RRHH ',id_departamento:'2'});
  assert.equal(res.statusCode,201);
  assert.equal(app.calls[0].data[0].id_departamento,2);
  assert.equal(app.calls[0].data[0].nombre,'Auditor RRHH');
  assert.equal(app.audits.length,1);
});
test('C05 cargo: permite departamento no asignado',async()=>{
  const app=appMock(c=>({data:{id_cargo:13,...c.data[0]},error:null}));
  await app.invoke('POST','/cargos',{nombre:'Operador',id_departamento:null});
  assert.equal(app.calls[0].data[0].id_departamento,null);
});
test('C05 cargo: rechaza departamento inválido antes de Supabase',async()=>{
  const app=appMock(()=>({data:null,error:null}));
  const res=await app.invoke('POST','/cargos',{nombre:'Analista',id_departamento:'0'});
  assert.equal(res.statusCode,400);assert.equal(app.calls.length,0);
});
test('C05 cargo: edita relación organizacional y mantiene auditoría',async()=>{
  const app=appMock(c=>({data:{id_cargo:3,...c.data},error:null}));
  const res=await app.invoke('PUT','/cargos/:id',{nombre:'Operador TI',id_departamento:'1'},{id:'3'});
  assert.equal(res.statusCode,200);
  assert.equal(app.calls[0].data.id_departamento,1);
  assert.equal(app.audits.length,1);
});
test('C05 cargo: incoherencia de departamento devuelve conflicto',async()=>{
  const app=appMock(()=>({data:null,error:{code:'23514',message:'CARGO_DEPARTAMENTO'}}));
  const res=await app.invoke('PUT','/cargos/:id',{nombre:'Operador TI',id_departamento:2},{id:'3'});
  assert.equal(res.statusCode,409);
});
test('C05 cargo: GET solicita referencia organizacional',async()=>{
  const app=appMock(()=>({data:[{id_cargo:3,nombre:'Operador',id_departamento:1}],error:null}));
  const res=await app.invoke('GET','/cargos');
  assert.equal(res.body.cargos[0].id_departamento,1);
  assert.match(app.calls[0].columns,/id_departamento/);
});
test('C05 departamentos: lista ordenada por ID técnico, interfaz muestra ordinal',async()=>{
  const app=appMock(()=>({data:[],error:null}));
  await app.invoke('GET','/departamentos');
  assert.equal(app.calls[0].order,'id_departamento');
});
test('C05 departamentos: impide eliminar un departamento vinculado a cargo',async()=>{
  const app=appMock(c=>({data:[],count:c.table==='cargos'?1:0,error:null}));
  const res=await app.invoke('DELETE','/departamentos/:id',{}, {id:'3'});
  assert.equal(res.statusCode,409);
  assert.equal(app.calls.filter(c=>c.operation==='delete').length,0);
});
test('C05 bitácora: rechaza límite fuera del contrato',async()=>{
  const app=appMock(()=>({data:[],error:null}));
  const res=await app.invoke('GET','/bitacora',{}, {}, {limite:'1000000'});
  assert.equal(res.statusCode,400);
  assert.equal(app.calls.length,0);
});
test('C05: SQL incluye FK, validación de empleados y rollback',()=>{
  const sql=fs.readFileSync(path.join(base,'../supabase/22_cargos_departamentos_admin_ux.sql'),'utf8');
  assert.match(sql,/FOREIGN KEY \(id_departamento\)/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OF id_cargo, id_departamento/);
  assert.match(sql,/CARGO_DEPARTAMENTO/);
  assert.ok(fs.existsSync(path.join(base,'../supabase/22_verify_cargos_departamentos_admin_ux.sql')));
  assert.ok(fs.existsSync(path.join(base,'../supabase/22_rollback_cargos_departamentos_admin_ux.sql')));
});
test('C05: navegación del chat separa contexto admin de empleado',()=>{
  const html=fs.readFileSync(path.join(base,'../rrhh-frontend/chat-empleado.html'),'utf8');
  const js=fs.readFileSync(path.join(base,'../rrhh-frontend/js/chat-empleado.js'),'utf8');
  assert.match(html,/id="chat-employee-session"/);
  assert.match(html,/href="notificaciones\.html"/);
  assert.match(js,/chat-portal-label/);
  assert.match(js,/md:hidden/);
});
test('C05: el frontend mantiene botones administrativos visibles',()=>{
  const js=fs.readFileSync(path.join(base,'../rrhh-frontend/js/empleados.js'),'utf8');
  assert.match(js,/admin-row-actions/);
  assert.match(js,/admin-status-pill/);
  assert.doesNotMatch(js,/opacity-0 group-hover:opacity-100/);
});
