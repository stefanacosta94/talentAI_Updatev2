const pdf = require("pdf-extraction");
const modeloGemini = require("../config/gemini");

const atsService = {
  /**
   * Extrae el texto de un PDF en memoria usando la librería moderna pdf-extraction
   */
  extraerTextoPDF: async (bufferPDF) => {
    try {
      // Le pasamos el buffer directamente, sin clases ni constructores raros
      const data = await pdf(bufferPDF);
      return data.text;
    } catch (error) {
      console.error("❌ Error técnico al leer el PDF:", error);
      throw new Error("No se pudo extraer el texto del currículum.");
    }
  },

  /**
   * Envía el CV y la vacante a Gemini para evaluación.
   */
  evaluarCandidato: async (textoCV, descripcionVacante) => {
    try {
      console.log("🧠 Analizando el CV con Gemini...");

      const prompt = `
            Actúa como un sistema ATS (Applicant Tracking System) experto en Recursos Humanos.
            Tu tarea es evaluar el texto de un currículum y compararlo con los requisitos de una vacante.

            DESCRIPCIÓN DE LA VACANTE:
            """${descripcionVacante}"""

            TEXTO DEL CURRÍCULUM:
            """${textoCV}"""

            Devuelve ÚNICAMENTE un objeto JSON con la siguiente estructura estricta, sin bloques de código Markdown ni texto adicional:
            {
                "ai_match_score": <número entero del 0 al 100>,
                "habilidades_encontradas": ["habilidad 1", "habilidad 2"],
                "habilidades_faltantes": ["habilidad faltante 1", "habilidad faltante 2"],
                "ai_resumen_habilidades": "<Resumen ejecutivo de 2 a 3 líneas sobre el perfil>"
            }
            `;

      const result = await modeloGemini.generateContent(prompt);
      const respuestaTexto = result.response.text();

      // Blindaje: Limpiamos el texto por si Gemini incluyó formato Markdown (```json)
      const textoLimpio = respuestaTexto
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(textoLimpio);
    } catch (error) {
      console.error("❌ Error en la IA durante la evaluación:", error);
      throw new Error("Fallo en el análisis inteligente del candidato.");
    }
  },
};

module.exports = atsService;
