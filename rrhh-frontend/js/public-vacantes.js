// Lectura pública de vacantes compartida por el portal de empleos y la presentación comercial.
// No utiliza tokens, claves de Supabase ni credenciales del usuario.
(function () {
  "use strict";

  function apiBaseURL() {
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    const devPort = ["5500", "5501", "5502", "8080", "8081"].includes(window.location.port);
    // Live Server puede estar en 127.0.0.1 o localhost. Utilizar el mismo hostname
    // evita errores de conexión local por diferencias entre IPv4/IPv6.
    if (isLocal && devPort) return `http://${hostname}:3000/api`;
    // Para otros despliegues se usa la URL explícita cuando es válida.
    if (typeof CONFIG !== "undefined" && CONFIG.API_URL) {
      const configured = String(CONFIG.API_URL).replace(/\/$/, "");
      if (!isLocal && /^https?:\/\/(localhost|127\.0\.0\.1):3000\/api\/?$/.test(configured)) return "/api";
      return configured;
    }
    return isLocal ? `http://${hostname}:3000/api` : "/api";
  }

  class PublicApiError extends Error {
    constructor(message, status = 0, code = "API_ERROR") {
      super(message);
      this.name = "PublicApiError";
      this.status = status;
      this.code = code;
    }
  }

  function friendlyMessage(error) {
    if (error.code === "NETWORK") return "No pudimos conectar con el servidor de TalentAI. Comprueba que Express esté iniciado y vuelve a intentarlo.";
    if (error.code === "TIMEOUT") return "La consulta tardó demasiado. Comprueba el estado del servidor e inténtalo nuevamente.";
    if (error.status === 404) return "No encontramos el servicio público de vacantes. Revisa la ruta de la API.";
    if ([502, 503, 504].includes(error.status)) return "El servicio de vacantes está temporalmente indisponible. Intenta nuevamente.";
    if (error.status === 429) return "Se alcanzó el límite de consultas. Vuelve a intentarlo en unos minutos.";
    return "No pudimos cargar las vacantes. Reintenta la consulta.";
  }

  async function fetchOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const url = `${apiBaseURL()}/public/vacantes`;
    try {
      const response = await fetch(url, {
        method: "GET", headers: { Accept: "application/json" }, signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new PublicApiError(json?.error || `Respuesta HTTP ${response.status}`, response.status, "HTTP");
      if (!json || json.exito !== true || !Array.isArray(json.vacantes)) {
        throw new PublicApiError("La respuesta de vacantes no coincide con el contrato esperado.", response.status, "FORMAT");
      }
      return json.vacantes;
    } catch (error) {
      if (error?.name === "AbortError") throw new PublicApiError("Tiempo de espera agotado", 0, "TIMEOUT");
      if (error instanceof TypeError) throw new PublicApiError(error.message, 0, "NETWORK");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function cargarVacantes() {
    try {
      return await fetchOnce();
    } catch (error) {
      // Una sola segunda lectura en casos transitorios. Nunca se reintentan postulaciones.
      if (!["NETWORK", "TIMEOUT"].includes(error.code) && ![502,503,504].includes(error.status)) throw error;
      await new Promise(resolve => setTimeout(resolve, 450));
      return fetchOnce();
    }
  }

  window.PublicVacanciesAPI = { apiBaseURL, cargarVacantes, friendlyMessage };
})();
