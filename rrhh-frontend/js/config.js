// ==========================================
// js/config.js
// Configuración y utilidades globales con Sesión Segura
// ==========================================

const CONFIG = {
  API_URL: "http://localhost:3000/api",
};

const SecurityUtils = {
  escapeHTML: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;"),

  safeHttpUrl: (value) => {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "#";
      return url.href;
    } catch (_) {
      return "#";
    }
  },
};

const AuthService = {
  // 1. Cambiamos localStorage por sessionStorage (Se destruye al cerrar el navegador/pestaña)
  iniciarSesion: (token, usuario) => {
    sessionStorage.setItem("ats_token", token);
    sessionStorage.setItem("ats_usuario", JSON.stringify(usuario));
  },

  // Recupera el token para hacer peticiones
  obtenerToken: () => sessionStorage.getItem("ats_token"),

  // Recupera los datos del usuario logueado
  obtenerUsuario: () => {
    const usr = sessionStorage.getItem("ats_usuario");
    return usr ? JSON.parse(usr) : null;
  },

  // 2. Borra todo y usa .replace() para que el botón "Atrás" no reviva la sesión
  cerrarSesion: () => {
    sessionStorage.removeItem("ats_token");
    sessionStorage.removeItem("ats_usuario");
    sessionStorage.clear();
    window.location.replace("index.html"); // Borra la página actual del historial
  },

  // Verifica si hay una sesión activa
  estaAutenticado: () => !!sessionStorage.getItem("ats_token"),

  esAdmin: () => AuthService.obtenerUsuario()?.rol === "admin",
};



// ==========================================
// SERVICIO GLOBAL DE FEEDBACK / NOTIFICACIONES
// ==========================================
const NotificationService = (() => {
  const TYPES = {
    success: { icon: "fa-circle-check", accent: "#16a34a", soft: "#f0fdf4", border: "#bbf7d0" },
    warning: { icon: "fa-triangle-exclamation", accent: "#d97706", soft: "#fffbeb", border: "#fde68a" },
    error: { icon: "fa-circle-xmark", accent: "#dc2626", soft: "#fef2f2", border: "#fecaca" },
    info: { icon: "fa-circle-info", accent: "#2563eb", soft: "#eff6ff", border: "#bfdbfe" },
  };

  function ensureStyles() {
    if (document.getElementById("notification-service-styles")) return;
    const style = document.createElement("style");
    style.id = "notification-service-styles";
    style.textContent = `
      #app-notifications {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        width: min(390px, calc(100vw - 32px));
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      }
      .app-toast {
        display: grid;
        grid-template-columns: 34px 1fr 28px;
        gap: 10px;
        align-items: start;
        padding: 14px 14px 14px 12px;
        border: 1px solid;
        border-radius: 16px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
        background: white;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-8px) scale(.98);
        transition: opacity .18s ease, transform .18s ease;
      }
      .app-toast.is-visible { opacity: 1; transform: translateY(0) scale(1); }
      .app-toast.is-leaving { opacity: 0; transform: translateY(-6px) scale(.98); }
      .app-toast__icon {
        width: 34px; height: 34px; border-radius: 10px; display: flex;
        align-items: center; justify-content: center; font-size: 15px;
      }
      .app-toast__title { margin: 0 0 3px; font-weight: 800; font-size: 13px; color: #0f172a; }
      .app-toast__message { margin: 0; font-size: 12px; line-height: 1.5; color: #475569; }
      .app-toast__close {
        border: 0; background: transparent; color: #94a3b8; cursor: pointer;
        width: 28px; height: 28px; border-radius: 8px; font-size: 14px;
      }
      .app-toast__close:hover { background: rgba(148, 163, 184, .12); color: #475569; }
      @media (max-width: 640px) {
        #app-notifications { top: 12px; right: 12px; left: 12px; width: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureContainer() {
    ensureStyles();
    let container = document.getElementById("app-notifications");
    if (!container) {
      container = document.createElement("div");
      container.id = "app-notifications";
      container.setAttribute("aria-live", "polite");
      container.setAttribute("aria-atomic", "true");
      document.body.appendChild(container);
    }
    return container;
  }

  function show({ type = "info", title = "", message = "", duration = 5000 } = {}) {
    const cfg = TYPES[type] || TYPES.info;
    const container = ensureContainer();
    const toast = document.createElement("div");
    toast.className = "app-toast";
    toast.style.borderColor = cfg.border;
    toast.style.borderLeft = `4px solid ${cfg.accent}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const icon = document.createElement("div");
    icon.className = "app-toast__icon";
    icon.style.background = cfg.soft;
    icon.style.color = cfg.accent;
    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${cfg.icon}`;
    icon.appendChild(iconEl);

    const content = document.createElement("div");
    const titleEl = document.createElement("p");
    titleEl.className = "app-toast__title";
    titleEl.textContent = title || "Información";
    const messageEl = document.createElement("p");
    messageEl.className = "app-toast__message";
    messageEl.textContent = message || "";
    content.append(titleEl, messageEl);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-toast__close";
    close.setAttribute("aria-label", "Cerrar notificación");
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    toast.append(icon, content, close);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    let timer;
    const dismiss = () => {
      if (!toast.isConnected) return;
      clearTimeout(timer);
      toast.classList.remove("is-visible");
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 190);
    };
    close.addEventListener("click", dismiss);
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return toast;
  }

  function apiError(response, data, fallback = "No fue posible completar la operación.") {
    const status = response?.status;
    const serverMessage = data?.error || data?.mensaje;
    const presets = {
      400: ["Revisa la información", serverMessage || fallback],
      401: ["Sesión no válida", "Tu sesión expiró o ya no es válida. Vuelve a iniciar sesión."],
      403: ["Acceso restringido", serverMessage || "No tienes permisos para realizar esta acción."],
      409: ["Acción no disponible", serverMessage || "La operación entra en conflicto con un registro existente."],
      413: ["Archivo demasiado grande", serverMessage || "El archivo supera el tamaño permitido."],
      429: ["Demasiados intentos", "Espera un momento antes de volver a intentarlo."],
      500: ["No pudimos completar la operación", "Ocurrió un error interno. Intenta nuevamente."],
      502: ["Servicio temporalmente no disponible", "No fue posible comunicarse con uno de los servicios. Intenta nuevamente."],
      503: ["Servicio temporalmente no disponible", "El servicio no está disponible en este momento. Intenta nuevamente."],
      504: ["Tiempo de espera agotado", "El servicio tardó demasiado en responder. Intenta nuevamente."],
    };
    const [title, message] = presets[status] || ["No pudimos completar la operación", serverMessage || fallback];
    return show({ type: status === 409 ? "warning" : "error", title, message });
  }

  return {
    show,
    success: (title, message, duration) => show({ type: "success", title, message, duration }),
    warning: (title, message, duration) => show({ type: "warning", title, message, duration }),
    error: (title, message, duration) => show({ type: "error", title, message, duration }),
    info: (title, message, duration) => show({ type: "info", title, message, duration }),
    apiError,
  };
})();

// ==========================================
// GUARDIÁN DE SESIÓN ESTRICTO
// ==========================================
(function () {
  function validarSeguridad() {
    const tokenSeguro = sessionStorage.getItem("ats_token");
    const rutaActual = window.location.pathname;

    const esPaginaPublica =
      rutaActual.endsWith("index.html") ||
      rutaActual.endsWith("/") ||
      rutaActual.endsWith("careers.html") ||
      rutaActual === "";

    if (!tokenSeguro && !esPaginaPublica) {
      window.location.replace("index.html");
      return;
    }

    const pagina = rutaActual.split("/").pop();
    const paginasSoloAdmin = new Set([
      "dashboard.html",
      "usuarios.html",
      "empleados.html",
      "candidatos.html",
      "conocimiento.html",
      "bitacora.html",
    ]);
    if (tokenSeguro && paginasSoloAdmin.has(pagina) && !AuthService.esAdmin()) {
      window.location.replace("chat-empleado.html");
    }
  }

  // 1. Validación inicial al cargar normalmente
  validarSeguridad();

  // 2. Validación y limpieza cuando el usuario presiona el botón "Atrás"
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      const tokenSeguro = sessionStorage.getItem("ats_token");
      const rutaActual = window.location.pathname;
      const esPaginaPublica =
        rutaActual.endsWith("index.html") ||
        rutaActual.endsWith("/") ||
        rutaActual.endsWith("careers.html") ||
        rutaActual === "";

      if (!tokenSeguro && !esPaginaPublica) {
        window.location.replace("index.html");
      } else if (esPaginaPublica) {
        // Si estamos en el login y se quedó congelado en "Conectando...",
        // forzamos una recarga limpia del navegador para resetear el formulario.
        window.location.reload();
      }
    }
  });
})();
