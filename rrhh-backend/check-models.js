require("dotenv").config();

async function listarModelos() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  console.log("🔍 Consultando a Google qué modelos tienes disponibles...");

  try {
    // Hacemos una petición directa a la API, saltándonos la librería
    const respuesta = await fetch(url);
    const datos = await respuesta.json();

    if (datos.models) {
      console.log("✅ ¡Estos son los nombres exactos que puedes usar!");
      console.log("--------------------------------------------------");

      // Filtramos para mostrar solo los modelos que sirven para generar texto
      datos.models.forEach((modelo) => {
        if (
          modelo.supportedGenerationMethods &&
          modelo.supportedGenerationMethods.includes("generateContent")
        ) {
          // Limpiamos el nombre para darte solo lo que necesitas copiar
          console.log(`👉 ${modelo.name.replace("models/", "")}`);
        }
      });
    } else {
      console.log("❌ Error en la llave o en la API:", datos);
    }
  } catch (error) {
    console.error("❌ Error de red:", error);
  }
}

listarModelos();
