'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const { fragmentarTexto, fingerprint, versionDeterministica } = require('../src/services/ragChunks');
const embeddingService = require('../src/services/ragEmbeddingService');

const sql = fs.readFileSync(path.join(root,'supabase/14_rag_pgvector.sql'),'utf8');
const ruta = fs.readFileSync(path.join(__dirname,'../src/routes/rag.routes.js'),'utf8');

test('RAG7: trocea documentos con solapamiento sin perder inicio ni final', () => {
  const text = 'Reglamento. '.repeat(900);
  const fragments = fragmentarTexto(text);
  assert.ok(fragments.length > 3);
  assert.equal(fragments[0].slice(0, 10), 'Reglamento');
  assert.ok(fragments.every(c => c.length > 0 && c.length <= 1700));
  assert.ok(fragments.at(-1).endsWith('Reglamento.'));
});

test('RAG7: versión de índice es estable para recuperación parcial y cambia con el contenido', () => {
  const v1 = versionDeterministica(1, fingerprint('contenido A'), 'gemini-embedding-001');
  const v2 = versionDeterministica(1, fingerprint('contenido A'), 'gemini-embedding-001');
  const v3 = versionDeterministica(1, fingerprint('contenido B'), 'gemini-embedding-001');
  assert.equal(v1,v2); assert.notEqual(v1,v3);
  assert.match(v1,/^[a-f0-9-]{36}$/);
});

test('RAG7: vector se normaliza y dimensión incompatible no se acepta', () => {
  const vector = Array(1536).fill(1);
  const normalized = embeddingService.normalizarVector(vector);
  assert.equal(normalized.length,1536);
  assert.ok(Math.abs(Math.hypot(...normalized)-1) < 1e-8);
  assert.throws(() => embeddingService.normalizarVector([1,2]));
  assert.throws(() => embeddingService.normalizarVector(Array(1536).fill(NaN)));
});

test('RAG7: llama a Gemini Embeddings con taskType y 1536, sin revelar API Key', async () => {
  const orig = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='no-real-test-key';
  try {
    let request;
    const result = await embeddingService.generarEmbedding('Permisos laborales', {
      tipo:'RETRIEVAL_QUERY',
      fetchFn: async (url,options) => {
        request={url,options};
        return { ok:true, json:async () => ({embedding:{values:Array(1536).fill(0.01)}}) };
      },
    });
    assert.equal(result.length,1536);
    assert.match(request.url,/gemini-embedding-001:embedContent$/);
    const payload=JSON.parse(request.options.body);
    assert.equal(payload.taskType,'RETRIEVAL_QUERY');
    assert.equal(payload.outputDimensionality,1536);
    assert.equal(request.options.headers['x-goog-api-key'],'no-real-test-key');
    assert.ok(!request.url.includes('no-real-test-key'));
  } finally { if(orig===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=orig; }
});

test('RAG7: errores 429 no registran contenido y se clasifican como cuota', async () => {
  const orig = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='no-real-test-key';
  try {
    await assert.rejects(embeddingService.generarEmbedding('Dato privado', {
      fetchFn:async () => ({ok:false,status:429,statusText:'Too Many Requests'})
    }), e=>e.code==='EMBEDDING_QUOTA' && e.isGeminiServiceError && !e.message.includes('Dato privado'));
  } finally { if(orig===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=orig; }
});

test('RAG7: SQL crea fragmentos privados y RPC con modelo y versión activa', () => {
  assert.match(sql,/base_conocimiento_fragmentos/);
  assert.match(sql,/base_conocimiento_indices/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql,/REVOKE ALL ON public\.base_conocimiento_fragmentos FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/p_modelo text/);
  assert.match(sql,/id_version=f\.id_version/);
  assert.match(sql,/md5\(v_texto\)/);
  assert.match(sql,/ON DELETE CASCADE/);
  assert.match(sql,/tr_rag_invalidar_documento/);
});

test('RAG7: no hace fallback al contexto documental íntegro', () => {
  // El SQL y la búsqueda deben conservarse, independientemente de comillas/saltos de línea.
  assert.match(ruta,/\.select\s*\(\s*(['"])id_documento\1\s*\)\s*\.\s*limit\s*\(\s*1\s*\)/);
  assert.doesNotMatch(ruta,/\.select\s*\(\s*(['"])contenido_texto\1\s*\)/);
  assert.doesNotMatch(ruta,/documentos\s*\.\s*map\s*\(\s*doc\s*=>\s*doc\s*\.\s*contenido_texto/);
  assert.match(ruta,/supabase\s*\.\s*rpc\s*\(\s*(['"])rag_buscar_fragmentos\1/);
  assert.match(ruta,/RAG_SIN_INDICE/);
});

function fixture({ totalIndex=1, matches=[], docs=[{id_documento:3}] }={}) {
  const calls=[];
  let handler;
  const fakeSupabase = {
    from(name) {
      calls.push(name);
      if(name==='base_conocimiento') return {select(){return {limit:async()=>({data:docs,error:null})};}};
      if(name==='base_conocimiento_indices') return {select(){return {eq:async()=>({count:totalIndex,error:null})};}};
      throw new Error('Tabla inesperada: '+name);
    },
    rpc(name, args){ calls.push(name); assert.equal(name,'rag_buscar_fragmentos'); assert.match(args.p_embedding,/^\[/); return Promise.resolve({data:matches,error:null}); },
  };
  const fakeExpress={ Router(){return {post(...args){handler=args.at(-1);calls.push(args.slice(0,-1));}};} };
  const module={ exports:{} };
  let modelCalls=0;
  vm.runInNewContext(ruta,{
    module,exports:module.exports,
    require(name){
      if(name==='express') return fakeExpress;
      if(name==='../config/supabase') return fakeSupabase;
      if(name==='../middlewares/authMiddleware') return function auth(){};
      if(name==='../middlewares/chatOnly') return function chatOnly(){};
      if(name==='../services/ragService') return {consultarReglamento:async(q,context)=>{modelCalls++;assert.ok(context.length<15000);return 'Respuesta verificable';}};
      if(name==='../services/ragEmbeddingService') return {modeloEmbedding:()=> 'gemini-embedding-001', generarEmbedding:async()=>Array(1536).fill(0.001)};
      throw new Error('Dependencia '+name);
    },
    process:{env:{}}, console,
  },{filename:'rag.routes.js'});
  const req={body:{pregunta:'¿Qué días libres corresponden?'}};
  let status=200, body=null, err=null;
  const res={status(s){status=s;return this;},json(v){body=v;return this;}};
  const run=async()=>{await handler(req,res,e=>{err=e;});return {status,body,err};};
  return {run,calls,get modelCalls(){return modelCalls;}};
}

test('RAG7: sin índice no llama al modelo y responde 409 sin descargar documentos',async()=>{
  const f=fixture({totalIndex:0}); const r=await f.run();
  assert.equal(r.status,409);assert.equal(r.body.codigo,'RAG_SIN_INDICE');
  assert.ok(!f.calls.includes('rag_buscar_fragmentos'));assert.equal(f.modelCalls,0);
});

test('RAG7: coincidencias documentales generan respuesta y fuentes identificables',async()=>{
  const f=fixture({matches:[{id_documento:3,titulo:'Política de vacaciones',indice_fragmento:0,contenido_fragmento:'La política reconoce vacaciones.'}]});
  const r=await f.run();
  assert.equal(r.status,200);assert.equal(r.body.exito,true);
  assert.equal(r.body.fuentes.length,1);assert.equal(r.body.fuentes[0].titulo,'Política de vacaciones');
  assert.equal(r.body.recuperados,1);assert.equal(f.modelCalls,1);
});

test('RAG7: sin coincidencias evita inventar respuesta e invocar Gemini generativo',async()=>{
  const f=fixture({matches:[]});const r=await f.run();
  assert.equal(r.body.exito,true);assert.equal(r.body.fuentes.length,0);assert.equal(f.modelCalls,0);
  assert.match(r.body.respuesta,/no tengo información/);
});

test('RAG7: UI presenta fuentes con textContent y no interpreta HTML recibido',()=>{
  const ui=fs.readFileSync(path.join(root,'rrhh-frontend/js/chat-empleado.js'),'utf8');
  assert.match(ui,/data\.fuentes/);assert.match(ui,/fuentes\.textContent/);
  assert.doesNotMatch(ui,/fuentes\.innerHTML\s*=/);
});
