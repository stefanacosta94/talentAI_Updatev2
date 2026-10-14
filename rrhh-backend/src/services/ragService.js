// 1. Importamos tu archivo de configuración centralizado
// (Nota: si gemini.js está en la raíz de tu proyecto, la ruta es '../../gemini'.
// Si está en src/config/, usa '../config/gemini')
const modeloGemini = require("../config/gemini");

async function consultarReglamento(preguntaEmpleado, textoDocumento) {
  try {
    // ESTE ES EL CORAZÓN DEL RAG: El Prompt de Sistema
    const prompt = `
        Eres el Asistente Virtual de Recursos Humanos de la empresa.
        Tu trabajo es responder las dudas de los empleados basándote ESTRICTAMENTE en el documento interno que te proporciono abajo.
        
        REGLAS ESTRICTAS:
        1. NO inventes información. Si la respuesta a la pregunta del empleado no se encuentra en el documento, debes responder EXACTAMENTE: "Lo siento, no tengo información sobre ese tema en el reglamento actual. Por favor, consulta directamente con el departamento de Recursos Humanos."
        2. Sé amable, claro y profesional.
        3. Si la información está, explícala de forma sencilla y directa.

        --- INICIO DEL DOCUMENTO DE LA EMPRESA ---
        ${textoDocumento}
        --- FIN DEL DOCUMENTO ---

        PREGUNTA DEL EMPLEADO: "${preguntaEmpleado}"
        `;

    // 2. Usamos directamente el modelo gemini-3.5-flash que exportaste
    const result = await modeloGemini.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("❌ Error en el motor RAG:", error);
    throw new Error(
      "No se pudo procesar la consulta con la Inteligencia Artificial.",
    );
  }
}

module.exports = { consultarReglamento };
