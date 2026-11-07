require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// --- ROUTERS ---
const authRouter = require("./src/routes/auth.routes");
const adminRouter = require("./src/routes/admin.routes");
const atsRouter = require("./src/routes/ats.routes");
const ragRouter = require("./src/routes/rag.routes");
const publicRouter = require("./src/routes/public.routes");
const notificacionesRouter = require("./src/routes/notificaciones.routes");
const resendWebhookRouter = require("./src/routes/resendWebhook.routes");
const { iniciarIndexadorAutomatico } = require("./src/services/ragAutoIndexer");
const {
  iniciarDespachadorAutomatico,
} = require("./src/services/resendAutoWorker");
// --- IMPORTACIONES DE CONFIGURACIÓN ---
const supabase = require("./src/config/supabase"); // <-- Nueva conexión a Supabase
const iaService = require("./src/services/iaService");
const atsService = require("./src/services/atsService");
const verificarToken = require("./src/middlewares/authMiddleware"); // <-- Nuestro nuevo guardia
const ragService = require("./src/services/ragService");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARES DE SEGURIDAD ---
app.use(helmet());
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:8080",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
// Webhook Resend: el cuerpo CRUDO debe preservarse para validar HMAC Svix.
// Montar antes de express.json() y con límite estricto de 64 KB.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { recibido: false },
});
app.use(
  "/api/webhooks/resend",
  webhookLimiter,
  express.raw({ type: "application/json", limit: "64kb" }),
  resendWebhookRouter,
);
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { exito: false, error: "Demasiadas peticiones, intenta más tarde." },
});
app.use("/api/", limiter);

// --- RUTAS ---
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/ats", atsRouter);
app.use("/api/empleados", ragRouter);
app.use("/api/public", publicRouter);
app.use("/api/admin/notificaciones", notificacionesRouter);

// --- RUTA DE ESTADO ---
app.get("/api/status", (req, res) => {
  res.json({
    mensaje: "Servidor TalentAI en línea 🚀🛡️",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

// --- RUTA 404 ---
app.use((req, res) => {
  res.status(404).json({ exito: false, error: "Ruta no encontrada." });
});

// --- MANEJADOR GLOBAL DE ERRORES ---
app.use((err, req, res, next) => {
  console.error("❌ Error no controlado:", err.stack || err);

  if (err && err.name === "MulterError") {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "El archivo excede el límite máximo permitido de 5 MB."
        : "No fue posible procesar el archivo enviado.";
    return res.status(400).json({ exito: false, error: message });
  }

  const status = Number.isInteger(err.status) ? err.status : 500;
  const isProduction = process.env.NODE_ENV === "production";
  const publicMessage =
    status >= 500 && isProduction
      ? "Error interno del servidor."
      : err.message || "Error interno del servidor.";

  res.status(status).json({ exito: false, error: publicMessage });
});

app.listen(PORT, () => {
  console.log(
    `✅ Servidor TalentAI v2.0 corriendo en http://localhost:${PORT}`,
  );
  iniciarIndexadorAutomatico();
  iniciarDespachadorAutomatico();
});
