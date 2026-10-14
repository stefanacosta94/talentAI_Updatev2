const modeloGemini = require("../config/gemini");

const iaService = {
  /**
   * Función básica para probar que Gemini responde
   */
  probarConexionIA: async (mensaje) => {
    try {
      console.log("🧠 Enviando mensaje a Gemini...");

      // Le damos una instrucción al modelo para que asuma su rol
      const prompt = `
                Eres el nuevo asistente de Inteligencia Artificial de una plataforma de Recursos Humanos. 
                Responde a este saludo de forma profesional, breve y entusiasta: "${mensaje}"
            `;

      const result = await modeloGemini.generateContent(prompt);
      const respuesta = result.response.text();

      return respuesta;
    } catch (error) {
      console.error("❌ Error en el servicio de IA:", error);
      throw new Error("No se pudo conectar con Gemini");
    }
  },
};

module.exports = iaService;
