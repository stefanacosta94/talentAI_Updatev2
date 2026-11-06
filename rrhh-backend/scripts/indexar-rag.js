"use strict";

// CLI de indexación gradual. Ejecutar desde rrhh-backend/ después de SQL 14:
// node scripts/indexar-rag.js --dry-run
// node scripts/indexar-rag.js --max-docs 1 --max-chunks 30
// node scripts/indexar-rag.js --id 3 --max-chunks 30
// Repetir el comando hasta que todos los documentos estén indexados.
require("dotenv").config();
const supabase = require("../src/config/supabase");
const {
  generarEmbedding,
  modeloEmbedding,
} = require("../src/services/ragEmbeddingService");
const {
  fragmentarTexto,
  fingerprint,
  versionDeterministica,
} = require("../src/services/ragChunks");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function options(argv = process.argv.slice(2)) {
  const opt = { dryRun: false, id: null, maxDocs: 1, maxChunks: 30 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opt.dryRun = true;
    else if (["--id", "--max-docs", "--max-chunks"].includes(arg)) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0)
        throw new Error(`Valor inválido para ${arg}`);
      if (arg === "--id") opt.id = n;
      if (arg === "--max-docs") opt.maxDocs = Math.min(n, 100);
      if (arg === "--max-chunks") opt.maxChunks = Math.min(n, 100);
    } else throw new Error(`Argumento no reconocido: ${arg}`);
  }
  return opt;
}

async function obtenerDocumentos(opt) {
  const docs = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    let query = supabase
      .from("base_conocimiento")
      .select("id_documento,titulo,contenido_texto")
      .order("id_documento", { ascending: true })
      .range(offset, offset + 99);
    if (opt.id) query = query.eq("id_documento", opt.id);
    const { data, error } = await query;
    if (error)
      throw new Error(
        `No se pudo leer base_conocimiento: ${error.code || "CONSULTA"}`,
      );
    docs.push(...(data || []));
    if ((data || []).length < 100 || opt.id) break;
  }
  return docs;
}

async function obtenerExistentes(id, version) {
  const existing = new Set();
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await supabase
      .from("base_conocimiento_fragmentos")
      .select("indice_fragmento")
      .eq("id_documento", id)
      .eq("id_version", version)
      .order("indice_fragmento", { ascending: true })
      .range(offset, offset + 499);
    if (error)
      throw new Error(
        `No se pudo consultar el avance del índice: ${error.code || "CONSULTA"}`,
      );
    for (const row of data || []) existing.add(row.indice_fragmento);
    if ((data || []).length < 500) break;
  }
  return existing;
}

async function indiceActual(id) {
  const { data, error } = await supabase
    .from("base_conocimiento_indices")
    .select("id_version,modelo_embedding,hash_contenido")
    .eq("id_documento", id)
    .maybeSingle();
  if (error)
    throw new Error(
      `No se pudo consultar el índice actual: ${error.code || "CONSULTA"}`,
    );
  return data;
}

async function indexarDocumento(doc, opt, budget) {
  const id = Number(doc.id_documento);
  const texto = doc.contenido_texto || "";
  const fragments = fragmentarTexto(texto);
  if (!fragments.length) {
    console.warn(`[RAG-INDEX] Documento ${id} sin texto: no se puede indexar.`);
    return { done: false, generated: 0 };
  }
  const modelo = modeloEmbedding();
  const hash = fingerprint(texto);
  const version = versionDeterministica(id, hash, modelo);
  const previous = await indiceActual(id);
  if (
    previous?.id_version === version &&
    previous?.modelo_embedding === modelo &&
    previous?.hash_contenido === hash
  ) {
    console.info(
      `[RAG-INDEX] Documento ${id} ya indexado (${fragments.length} fragmentos).`,
    );
    return { done: true, alreadyIndexed: true, generated: 0 };
  }
  const existing = await obtenerExistentes(id, version);
  const missing = fragments.map((_, i) => i).filter((i) => !existing.has(i));
  console.info(
    `[RAG-INDEX] Documento ${id}: ${fragments.length} fragmentos; ${existing.size} guardados; ${missing.length} pendientes.`,
  );
  if (opt.dryRun) return { done: false, generated: 0 };
  let generated = 0;
  const delayMs = Math.max(
    1000,
    Math.min(10000, Number(process.env.RAG_EMBED_DELAY_MS) || 1600),
  );
  for (const i of missing) {
    if (budget.used >= opt.maxChunks) break;
    const embedding = await generarEmbedding(fragments[i], {
      tipo: "RETRIEVAL_DOCUMENT",
    });
    const { error } = await supabase
      .from("base_conocimiento_fragmentos")
      .upsert(
        {
          id_documento: id,
          id_version: version,
          indice_fragmento: i,
          contenido_fragmento: fragments[i],
          modelo_embedding: modelo,
          embedding: `[${embedding.join(",")}]`,
        },
        {
          onConflict: "id_documento,id_version,indice_fragmento",
          ignoreDuplicates: true,
        },
      );
    if (error)
      throw new Error(
        `No se pudo guardar el fragmento: ${error.code || "ESCRITURA"}`,
      );
    budget.used++;
    generated++;
    if (generated % 10 === 0)
      console.info(
        `[RAG-INDEX] Documento ${id}: ${existing.size + generated}/${fragments.length} fragmentos guardados.`,
      );
    // Conservador con RPM/TPM del plan gratuito. Sin ráfagas concurrentes.
    if (budget.used < opt.maxChunks) await sleep(delayMs);
  }
  if (existing.size + generated < fragments.length) {
    console.info(
      `[RAG-INDEX] Documento ${id}: indexación parcial segura. Ejecuta el comando nuevamente.`,
    );
    return { done: false, generated };
  }
  const { data, error } = await supabase.rpc("rag_activar_indice", {
    p_id_documento: id,
    p_id_version: version,
    p_modelo: modelo,
    p_hash_contenido: hash,
    p_total_fragmentos: fragments.length,
  });
  if (error || data !== true)
    throw new Error(
      `No se pudo activar el índice: ${error?.code || "ACTIVACION"}`,
    );
  console.info(
    `[RAG-INDEX] Documento ${id} ACTIVADO con ${fragments.length} fragmentos.`,
  );
  return { done: true, generated };
}

async function main() {
  const opt = options();
  const docs = await obtenerDocumentos(opt);
  const budget = { used: 0 };
  let considered = 0,
    completed = 0;
  for (const doc of docs) {
    if (considered >= opt.maxDocs || budget.used >= opt.maxChunks) break;
    const result = await indexarDocumento(doc, opt, budget);
    if (result.alreadyIndexed && !opt.id) continue;
    considered++;
    if (result.done) completed++;
  }
  console.info("[RAG-INDEX] Resumen", {
    documentosRevisados: considered,
    documentosCompletos: completed,
    embeddingsNuevos: budget.used,
    simulacion: opt.dryRun,
  });
}

if (require.main === module)
  main().catch((err) => {
    // Nunca imprimir objetos crudos de proveedores: pueden incluir respuestas no confiables.
    console.error("[RAG-INDEX] Error:", err.message);
    process.exitCode = 1;
  });

module.exports = {
  options,
  obtenerDocumentos,
  obtenerExistentes,
  indexarDocumento,
};
