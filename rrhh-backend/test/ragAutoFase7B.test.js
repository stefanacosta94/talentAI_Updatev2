'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const workSource = fs.readFileSync(path.join(__dirname, '../src/services/ragAutoIndexer.js'),'utf8');
const moduleUnderTest={exports:{}};
vm.runInNewContext(workSource,{ module:moduleUnderTest, exports:moduleUnderTest.exports,
  require(name) {
    if(name==='../config/supabase') return {};
    if(name==='../../scripts/indexar-rag') return {indexarDocumento:async()=>{},obtenerExistentes:async()=>new Set()};
    if(name==='./ragChunks') return require('../src/services/ragChunks');
    if(name==='./ragEmbeddingService') return {modeloEmbedding:()=> 'gemini-embedding-001'};
    throw new Error(`Unexpected import: ${name}`);
  }, process, console, setTimeout, setInterval, clearTimeout, clearInterval, Date,
},{filename:'ragAutoIndexer.js'});
const worker=moduleUnderTest.exports;
const sql = fs.readFileSync(path.join(root, 'supabase/15_rag_index_queue.sql'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../src/routes/admin.routes.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'rrhh-frontend/js/conocimiento.js'), 'utf8');
const rag = fs.readFileSync(path.join(__dirname, '../src/routes/rag.routes.js'), 'utf8');

function clientePrueba({ tarea = [{id_documento:9,lease_token:'test-token'}],
  texto = 'Reglamento ' .repeat(700), errores = 0 } = {}) {
  const llamadas=[];
  const db={
    async rpc(name, args) {
      llamadas.push({name,args});
      if(name==='rag_tomar_tarea') return {data:tarea,error:null};
      if(name==='rag_finalizar_lote') return {data:true,error:null};
      throw new Error(`RPC inesperada: ${name}`);
    },
    from(table) {
      if(!['base_conocimiento','rag_tareas_indexacion'].includes(table)) throw new Error(table);
      return {select() {return {eq() {return {async maybeSingle() {
        if(table==='base_conocimiento') return {data:{id_documento:9,contenido_texto:texto},error:null};
        return {data:{errores_consecutivos:errores},error:null};
      }};}};}};
    }
  };
  return {db,llamadas};
}

test('7B: migración crea cola privada y conserva documentos/embeddings de 7A',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.rag_tareas_indexacion/);
  assert.match(sql,/ON DELETE CASCADE/);
  assert.match(sql,/ON CONFLICT \(id_documento\) DO NOTHING/);
  assert.match(sql,/LEFT JOIN public\.base_conocimiento_indices/);
  assert.doesNotMatch(sql,/DROP TABLE\s+(?:public\.)?base_conocimiento(?:_fragmentos|_indices)?\b/i);
});

test('7B: triggers encolan INSERT y cambios de texto, no edición del título',()=>{
  assert.match(sql,/AFTER INSERT ON public\.base_conocimiento/);
  assert.match(sql,/AFTER UPDATE OF contenido_texto ON public\.base_conocimiento/);
  assert.match(sql,/NEW\.contenido_texto IS NOT DISTINCT FROM OLD\.contenido_texto/);
  assert.match(sql,/lease_token=NULL/);
});

test('7B: el reclamo es atómico, usa SKIP LOCKED y tiene lease recuperable',()=>{
  assert.match(sql,/FOR UPDATE SKIP LOCKED/);
  assert.match(sql,/v_token := gen_random_uuid\(\)/);
  assert.match(sql,/lease_hasta<now\(\)/);
  assert.match(sql,/t\.lease_token=p_lease_token AND t\.lease_hasta>now\(\)/);
});

test('7B: los RPC y la tabla están protegidos y sólo service_role opera',()=>{
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON public\.rag_tareas_indexacion FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.rag_tomar_tarea\(\) TO service_role/);
  assert.match(sql,/rag_reprogramar_tarea|rag_reintentar_tarea/);
});

test('7B: no inicia worker sin habilitación explícita y limita tamaños de lote',()=>{
  const anterior=process.env.RAG_AUTO_INDEX_ENABLED;
  process.env.RAG_AUTO_INDEX_ENABLED='false';
  try { assert.equal(worker.iniciarIndexadorAutomatico(),null); }
  finally { if(anterior==null) delete process.env.RAG_AUTO_INDEX_ENABLED; else process.env.RAG_AUTO_INDEX_ENABLED=anterior; }
  assert.equal(worker.enteroSeguro('11',3,1,10),3);
  assert.equal(worker.enteroSeguro('4',3,1,10),4);
});

test('7B: completa un lote parcial y guarda el progreso de forma atómica',async()=>{
  const {db,llamadas}=clientePrueba();
  const r=await worker.procesarLote({db,porCiclo:2,
    indexar:async(_doc,opt,budget)=>{assert.equal(opt.maxChunks,2);budget.used=2;return {done:false};},
    existentes:async()=>new Set([0,1]),
  });
  assert.equal(r.estado,'parcial'); assert.equal(r.guardados,2);
  const fin=llamadas.find(x=>x.name==='rag_finalizar_lote');
  assert.equal(fin.args.p_lease_token,'test-token');
  assert.equal(fin.args.p_estado,'parcial');
  assert.equal(fin.args.p_guardados,2);
  assert.equal(fin.args.p_espera_segundos,90);
});

test('7B: no activa una versión parcial del documento',async()=>{
  const {db,llamadas}=clientePrueba();
  const r=await worker.procesarLote({db,indexar:async()=>({done:false}),existentes:async()=>new Set([0])});
  assert.equal(r.estado,'parcial');
  assert.ok(!llamadas.some(x=>x.name==='rag_activar_indice'));
});

test('7B: cuota Gemini registra código seguro y programa espera prolongada',async()=>{
  const {db,llamadas}=clientePrueba({errores:0});
  const r=await worker.procesarLote({db,indexar:async()=>{throw Object.assign(new Error('PII NO LOGUEAR'),{code:'EMBEDDING_QUOTA'});},existentes:async()=>new Set([0])});
  assert.equal(r.codigo,'EMBEDDING_QUOTA');
  const fin=llamadas.find(x=>x.name==='rag_finalizar_lote');
  assert.equal(fin.args.p_estado,'error');
  assert.equal(fin.args.p_espera_segundos,3600);
  assert.ok(!JSON.stringify(fin).includes('PII NO LOGUEAR'));
});

test('7B: errores repetidos pausarán el documento para revisión',async()=>{
  const {db,llamadas}=clientePrueba({errores:2});
  const r=await worker.procesarLote({db,indexar:async()=>{throw new Error('Error de red y datos privados');},existentes:async()=>new Set()});
  assert.equal(r.estado,'pausado');
  assert.equal(llamadas.find(x=>x.name==='rag_finalizar_lote').args.p_espera_segundos,0);
});

test('7B: sin trabajos elegibles no realiza consultas ni consume embeddings',async()=>{
  const {db,llamadas}=clientePrueba({tarea:[]});
  const r=await worker.procesarLote({db,indexar:async()=>{throw new Error('no');}});
  assert.equal(r.procesado,false);
  assert.equal(llamadas.length,1);
});

test('7B: estado y reintento son rutas admin sin descargar textos ni vectores',()=>{
  assert.match(admin,/router\.use\(verificarToken, adminOnly\)/);
  assert.match(admin,/\.from\('rag_tareas_indexacion'\)/);
  assert.match(admin,/router\.post\('\/documentos\/:id\/indexacion\/reintentar'/);
  assert.match(admin,/rag_reintentar_tarea/);
  assert.match(ui,/estadoIndexacion/);
  assert.match(ui,/btn-reintentar-indice/);
  assert.match(ui,/SecurityUtils\.escapeHTML\(texto\)/);
});

test('7B: asistente separa referencias citadas y suprime fuentes para NO_INFO',()=>{
  assert.match(rag,/fuentes_citadas/);
  assert.match(rag,/sin_evidencia/);
  assert.match(rag,/matchAll\(/);
  const chat=fs.readFileSync(path.join(root,'rrhh-frontend/js/chat-empleado.js'),'utf8');
  assert.match(chat,/Fragmentos recuperados \(no citados explícitamente\)/);
  assert.match(chat,/Referencias citadas por la IA/);
  assert.match(chat,/fuentes\.textContent/);
});
