const PDFDocument = require("pdfkit");
const fs = require("fs");

const doc = new PDFDocument();

// Creamos el "puente" de escritura
const stream = fs.createWriteStream("cv_prueba.pdf");
doc.pipe(stream);

doc
  .fontSize(20)
  .text("Currículum Vitae: Candidato de Prueba", { align: "center" });
doc.moveDown();
doc.fontSize(14).text("Perfil Profesional:", { underline: true });
doc
  .fontSize(12)
  .text(
    "Desarrollador backend con conocimientos sólidos en arquitecturas asíncronas y bases de datos relacionales.",
  );
doc.moveDown();
doc.fontSize(14).text("Habilidades Técnicas:", { underline: true });
doc
  .fontSize(12)
  .text(
    "- Node.js y Express\n- PostgreSQL y Supabase\n- Estructuración de APIs REST\n- Integración de Inteligencia Artificial (LLMs)",
  );
doc.moveDown();
doc.fontSize(14).text("Experiencia:", { underline: true });
doc
  .fontSize(12)
  .text(
    "Desarrollo de plataforma de Recursos Humanos centralizada con automatización de procesos mediante IA.",
  );

// Finalizamos el documento
doc.end();

// ¡NUEVO!: Esperamos a que el disco duro termine de guardar el archivo
stream.on("finish", () => {
  console.log(
    "✅ ¡El archivo 'cv_prueba.pdf' ha sido generado COMPLETO y guardado con éxito!",
  );
});
