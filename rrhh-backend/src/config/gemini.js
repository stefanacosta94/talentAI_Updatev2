const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ FALTA LA LLAVE: Agrega GEMINI_API_KEY a tu archivo .env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const modeloGemini = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
});

module.exports = modeloGemini;
