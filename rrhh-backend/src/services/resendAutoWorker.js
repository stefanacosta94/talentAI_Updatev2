"use strict";

// TalentAI 8A: worker AUTORIZADO PARA PRUEBAS únicamente.
// Doble opt-in: .env global y autorización nueva por notificación (SQL 16).
// Resend 5D conserva el transporte, el destinatario fijo y la idempotencia.
const supabase = require("../config/supabase");
const { configResendTest } = require("./resendTestTransport");
const {
  createResendTestRepository,
  procesarUnaPrueba,
} = require("./resendTestProcessor");

function enteroControlado(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new TypeError(
      `Configuración de automatización fuera del rango ${min}-${max}.`,
    );
  }
  return n;
}

function configResendAuto(env = process.env) {
  if (env.RESEND_AUTO_ENABLED !== "true") {
    throw Object.assign(new Error("Despacho automático deshabilitado."), {
      code: "AUTO_DISABLED",
    });
  }
  // Rechazar credenciales/modo/destinatario inválidos ANTES de tocar PostgreSQL.
  configResendTest(env);
  return Object.freeze({
    intervaloMs: enteroControlado(
      env.RESEND_AUTO_POLL_MS,
      60000,
      30000,
      3600000,
    ),
    maxDiario: enteroControlado(env.RESEND_AUTO_MAX_PER_DAY, 5, 1, 20),
  });
}

function createResendAutoRepository(db = supabase, maxDiario = 5) {
  const base = createResendTestRepository(db);
  return {
    reclamar: async () => {
      const { data, error } = await db.rpc(
        "talentai_reclamar_notificaciones_resend_auto",
        {
          p_max_diario: maxDiario,
        },
      );
      if (error) {
        // Diagnóstico mínimo: se conserva únicamente el código PostgREST/SQLSTATE,
        // nunca mensaje, detalles, hint, URL, correo ni credenciales.
        const codigo = String(error.code || "");
        const sqlstateSeguro = /^(?:PGRST[0-9]{3}|[A-Z0-9]{5})$/.test(codigo)
          ? codigo
          : "RPC_ERROR";
        throw Object.assign(
          new Error("No fue posible reservar una notificación de prueba."),
          {
            code: "AUTO_DB",
            sqlstateSeguro,
          },
        );
      }
      return data;
    },
    finalizar: base.finalizar,
  };
}

async function procesarCicloAutomatico({
  env = process.env,
  db = supabase,
  enviarUna = procesarUnaPrueba,
  repo = null,
} = {}) {
  const config = configResendAuto(env);
  // La finalización y el transporte son EXACTAMENTE los ya probados en 5D.
  return enviarUna({
    repo: repo || createResendAutoRepository(db, config.maxDiario),
    env,
  });
}

function iniciarDespachadorAutomatico({
  env = process.env,
  ejecutar = procesarCicloAutomatico,
  programarIntervalo = setInterval,
  programarInicio = setTimeout,
  cancelarIntervalo = clearInterval,
  cancelarInicio = clearTimeout,
  logger = console,
} = {}) {
  if (env.RESEND_AUTO_ENABLED !== "true") {
    logger.info(
      "[RESEND-AUTO] Desactivado; el envío manual 5D sigue disponible.",
    );
    return null;
  }
  let configuracion;
  try {
    configuracion = configResendAuto(env);
  } catch (_) {
    logger.warn(
      "[RESEND-AUTO] Configuración no válida. No se inicia el despachador.",
    );
    return null;
  }
  let ejecutando = false;
  let detenido = false;
  const tick = async () => {
    if (detenido || ejecutando) return;
    ejecutando = true;
    try {
      // Volver a validar los controles en cada ciclo.
      const resumen = await ejecutar({ env });
      if (resumen?.reclamadas) {
        logger.info("[RESEND-AUTO] Ciclo", {
          reclamadas: resumen.reclamadas,
          aceptadas: resumen.aceptadas,
          rechazadas: resumen.rechazadas,
          inciertas: resumen.inciertas,
          sin_finalizar: resumen.sin_finalizar,
        });
      }
    } catch (error) {
      // Mostrar únicamente un código validado; NUNCA el error crudo o sus datos.
      const codigo =
        error?.code === "AUTO_DB"
          ? error.sqlstateSeguro || "RPC_ERROR"
          : "PROCESSING_ERROR";
      logger.warn("[RESEND-AUTO] Ciclo no completado", { codigo });
    } finally {
      ejecutando = false;
    }
  };
  const inicio = programarInicio(tick, 4000);
  inicio?.unref?.();
  const intervalo = programarIntervalo(tick, configuracion.intervaloMs);
  intervalo?.unref?.();
  logger.info("[RESEND-AUTO] Trabajador habilitado (SOLO PRUEBAS)", {
    intervaloMs: configuracion.intervaloMs,
    maxReservasDiarias: configuracion.maxDiario,
    destinatariosReales: false,
  });
  return {
    tick,
    detener() {
      detenido = true;
      cancelarIntervalo(intervalo);
      cancelarInicio(inicio);
    },
  };
}

module.exports = {
  enteroControlado,
  configResendAuto,
  createResendAutoRepository,
  procesarCicloAutomatico,
  iniciarDespachadorAutomatico,
};
