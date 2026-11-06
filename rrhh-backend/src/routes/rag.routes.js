"use strict";
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const verificarToken = require("../middlewares/authMiddleware");
const chatOnly = require("../middlewares/chatOnly");
const ragService = require("../services/ragService");
const {
  generarEmbedding,
  modeloEmbedding,
} = require("../services/ragEmbeddingService");

const NO_INFO =
  "Lo siento, no tengo información sobre ese tema en el reglamento actual. Por favor, consulta directamente con el departamento de Recursos Humanos.";

function obtenerTopK(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= 8 ? num : 5;
}
function obtenerUmbral(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0.2 && num <= 0.85 ? num : 0.35;
}

function prepararContexto(fragmentos) {
  const citas = [];
  const contexto = [];
  const vistos = new Set();
  fragmentos.forEach((f, i) => {
    const titulo = String(f.titulo || "Documento interno").slice(0, 180);
    const id = Number(f.id_documento);
    const fragmento = Number(f.indice_fragmento);
    const clave = `${id}:${fragmento}`;
    if (!vistos.has(clave)) {
      vistos.add(clave);
      citas.push({ id_documento: id, titulo, fragmento: fragmento + 1 });
    }
    // Acotamos contexto incluso si la base de datos devuelve contenido inesperado.
    contexto.push(
      `[Fuente ${i + 1}: ${titulo}, fragmento ${fragmento + 1}]\n${String(f.contenido_fragmento || "").slice(0, 1900)}`,
    );
  });
  return { contexto: contexto.join("\n\n---\n\n"), fuentes: citas };
}

router.post("/chat", verificarToken, chatOnly, async (req, res, next) => {
  try {
    const pregunta =
      typeof req.body?.pregunta === "string" ? req.body.pregunta.trim() : "";
    if (pregunta.length < 3 || pregunta.length > 600) {
      return res
        .status(400)
        .json({
          exito: false,
          error: "Escribe una pregunta de entre 3 y 600 caracteres.",
        });
    }
    // Comprobación mínima de documentos: NUNCA recuperar contenido_texto completo en el chat.
    // Se realiza solo después de verificar JWT y el vínculo laboral (Fase 6A).
    const { data: documentos, error } = await supabase
      .from("base_conocimiento")
      .select("id_documento")
      .limit(1);
    if (error) return next(error);
    if (!documentos?.length)
      return res
        .status(409)
        .json({
          exito: false,
          codigo: "RAG_SIN_DOCUMENTOS",
          error: "Todavía no se han cargado documentos internos.",
        });

    const modelo = modeloEmbedding();
    const { count, error: errorIndice } = await supabase
      .from("base_conocimiento_indices")
      .select("id_documento", { count: "exact", head: true })
      .eq("modelo_embedding", modelo);
    if (errorIndice) return next(errorIndice);
    if (!count)
      return res.status(409).json({
        exito: false,
        codigo: "RAG_SIN_INDICE",
        error:
          "La base documental aún no está indexada. Un administrador debe ejecutar la indexación RAG.",
      });

    // Un embedding pequeño por pregunta, en vez de enviar todos los documentos al modelo generativo.
    const embedding = await generarEmbedding(pregunta, {
      tipo: "RETRIEVAL_QUERY",
    });
    const { data: fragmentos, error: errorBusqueda } = await supabase.rpc(
      "rag_buscar_fragmentos",
      {
        p_embedding: `[${embedding.join(",")}]`,
        p_modelo: modelo,
        p_top_k: obtenerTopK(process.env.RAG_TOP_K),
        p_umbral: obtenerUmbral(process.env.RAG_SIMILARITY_THRESHOLD),
      },
    );
    if (errorBusqueda) return next(errorBusqueda);
    if (!fragmentos?.length)
      return res.json({
        exito: true,
        respuesta: NO_INFO,
        fuentes: [],
        recuperados: 0,
      });

    const { contexto, fuentes } = prepararContexto(fragmentos);
    const respuestaIA = await ragService.consultarReglamento(
      pregunta,
      contexto,
    );
    res.json({
      exito: true,
      respuesta: respuestaIA,
      fuentes,
      recuperados: fragmentos.length,
    });
  } catch (error) {
    if (error?.isGeminiServiceError) {
      return res.status(error.status).json({
        exito: false,
        error: error.message,
        codigo: error.code,
        reintentar: error.retryable,
      });
    }
    next(error);
  }
});

module.exports = router;
