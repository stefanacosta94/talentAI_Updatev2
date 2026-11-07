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
// DIÁLOGOS TALENTAI (asíncronos y accesibles)
// ==========================================
// No sustituir window.confirm/alert/prompt: son APIs síncronas del navegador.
// Usar `await DialogService.confirm(...)` antes de acciones sensibles.
const DialogService = (() => {
  const VARIANTS = Object.freeze({
    info: { symbol: 'i', title: 'Confirmar operación' },
    warning: { symbol: '!', title: 'Revisar operación' },
    danger: { symbol: '!', title: 'Confirmar acción sensible' },
    success: { symbol: '✓', title: 'Operación completada' },
  });
  let queue = Promise.resolve();
  let counter = 0;

  function ensureStyles() {
    if (document.getElementById('talentai-dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'talentai-dialog-styles';
    style.textContent = `
      .ta-dialog {
        width: min(460px, calc(100vw - 32px)); max-width: calc(100vw - 32px);
        max-height: min(90vh, 680px); overflow-y: auto;
        position: fixed; margin: auto; padding: 0;
        border: 1px solid #dbe4f2; border-radius: 20px;
        background: #fff; color: #18294b;
        box-shadow: 0 28px 75px rgba(13, 30, 65, .22);
        font-family: inherit;
      }
      .ta-dialog::backdrop { background: rgba(10, 23, 49, .55); backdrop-filter: blur(3px); }
      .ta-dialog__body { padding: 25px 27px 16px; }
      .ta-dialog__top { display: flex; align-items: flex-start; gap: 13px; }
      .ta-dialog__symbol {
        flex: 0 0 44px; height: 44px; border-radius: 13px;
        display: grid; place-items: center;
        font-size: 24px; font-weight: 900; line-height: 1;
        background: #eaf1ff; color: #2357cd;
      }
      .ta-dialog[data-variant="danger"] .ta-dialog__symbol { background: #fff0f2; color: #c5294b; }
      .ta-dialog[data-variant="warning"] .ta-dialog__symbol { background: #fff3dd; color: #a96308; }
      .ta-dialog[data-variant="success"] .ta-dialog__symbol { background: #e5f8ed; color: #177245; }
      .ta-dialog__heading { min-width: 0; padding-top: 2px; }
      .ta-dialog__eyebrow {
        margin: 0 0 5px; font-size: 10px; letter-spacing: .11em;
        text-transform: uppercase; color: #4465a3; font-weight: 850;
      }
      .ta-dialog__title {
        margin: 0; color: #142653; font-size: 20px; line-height: 1.28;
        letter-spacing: -.025em; font-weight: 850;
      }
      .ta-dialog__message {
        margin: 17px 0 4px; color: #51627e; font-size: 13px;
        line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .ta-dialog__field { margin: 16px 0 4px; }
      .ta-dialog__field-label { display: block; font-size: 12px; color: #364b6c; font-weight: 750; margin-bottom: 7px; }
      .ta-dialog__input {
        box-sizing: border-box; width: 100%; border: 1px solid #ccd9ec;
        border-radius: 10px; padding: 11px 12px; font: inherit; font-size: 13px; outline: 0;
        color: #172b51; background: #fff;
      }
      .ta-dialog__input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .10); }
      .ta-dialog__error { margin: 6px 0 0; font-size: 11px; color: #ae2e48; }
      .ta-dialog__actions {
        display: flex; justify-content: flex-end; gap: 9px;
        flex-wrap: wrap; padding: 16px 27px 24px;
      }
      .ta-dialog__btn {
        min-height: 40px; padding: 10px 18px; border: 1px solid transparent;
        border-radius: 10px; font: inherit; font-size: 12px; font-weight: 800;
        cursor: pointer; transition: background .15s ease, box-shadow .15s ease;
      }
      .ta-dialog__btn:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
      .ta-dialog__btn--cancel { background: #f2f5fa; color: #344867; border-color: #e0e7f1; }
      .ta-dialog__btn--cancel:hover { background: #e8edf6; }
      .ta-dialog__btn--ok { background: #2459e6; color: #fff; }
      .ta-dialog__btn--ok:hover { background: #1747c9; }
      .ta-dialog[data-variant="danger"] .ta-dialog__btn--ok { background: #be294a; }
      .ta-dialog[data-variant="danger"] .ta-dialog__btn--ok:hover { background: #9e1c3a; }
      .ta-dialog[data-variant="warning"] .ta-dialog__btn--ok { background: #a96308; }
      .ta-dialog[data-variant="warning"] .ta-dialog__btn--ok:hover { background: #8d5005; }
      @media (max-width: 480px) {
        .ta-dialog__body { padding: 20px 19px 12px; }
        .ta-dialog__actions { padding: 14px 19px 20px; }
        .ta-dialog__btn { flex: 1 1 auto; }
        .ta-dialog__title { font-size: 18px; }
      }
      @media (prefers-reduced-motion: no-preference) {
        .ta-dialog[open] { animation: ta-dialog-appear .17s ease-out; }
        @keyframes ta-dialog-appear { from { opacity: .7; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
      }
    `;
    document.head.appendChild(style);
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  function present({ kind, message, options }) {
    return new Promise((resolve) => {
      ensureStyles();
      const variant = Object.hasOwn(VARIANTS, options.variant) ? options.variant : 'info';
      const dialog = node('dialog', 'ta-dialog');
      dialog.dataset.variant = variant;
      const id = `talentai-dialog-${++counter}`;
      dialog.setAttribute('aria-labelledby', `${id}-title`);
      dialog.setAttribute('aria-describedby', `${id}-message`);
      dialog.setAttribute('aria-modal', 'true');
      const body = node('div', 'ta-dialog__body');
      const top = node('div', 'ta-dialog__top');
      const symbol = node('span', 'ta-dialog__symbol', VARIANTS[variant].symbol);
      symbol.setAttribute('aria-hidden', 'true');
      const heading = node('div', 'ta-dialog__heading');
      heading.append(
        node('p', 'ta-dialog__eyebrow', options.eyebrow || 'TalentAI · Administración'),
      );
      const title = node('h2', 'ta-dialog__title', options.title || VARIANTS[variant].title);
      title.id = `${id}-title`;
      heading.append(title);
      top.append(symbol, heading);
      const msg = node('p', 'ta-dialog__message', message);
      msg.id = `${id}-message`;
      body.append(top, msg);

      let input = null;
      let error = null;
      if (kind === 'prompt') {
        const field = node('div', 'ta-dialog__field');
        const label = node('label', 'ta-dialog__field-label', options.label || 'Respuesta');
        label.htmlFor = `${id}-input`;
        input = node('input', 'ta-dialog__input');
        input.id = `${id}-input`;
        input.type = 'text';
        input.value = String(options.defaultValue ?? '');
        input.maxLength = Math.max(1, Math.min(1000, Number(options.maxLength) || 250));
        if (options.placeholder) input.placeholder = String(options.placeholder);
        error = node('p', 'ta-dialog__error', 'Este campo es obligatorio.');
        error.hidden = true;
        field.append(label, input, error);
        body.append(field);
      }

      const actions = node('div', 'ta-dialog__actions');
      const btnCancel = kind === 'alert' ? null : node('button', 'ta-dialog__btn ta-dialog__btn--cancel', options.cancelText || 'Cancelar');
      const btnOk = node('button', 'ta-dialog__btn ta-dialog__btn--ok', options.confirmText || (kind === 'alert' ? 'Entendido' : 'Confirmar'));
      btnOk.type = 'button';
      if (btnCancel) { btnCancel.type = 'button'; actions.append(btnCancel); }
      actions.append(btnOk);
      dialog.append(body, actions);
      const previousFocus = document.activeElement;
      let settled = false;
      const cancelValue = kind === 'prompt' ? null : false;
      function finish(value) {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
          previousFocus.focus({ preventScroll: true });
        }
        resolve(value);
      }
      function accept() {
        if (input) {
          if (options.required && !input.value.trim()) {
            error.hidden = false;
            input.focus();
            return;
          }
          finish(input.value);
        } else {
          finish(true);
        }
      }
      btnOk.addEventListener('click', accept);
      btnCancel?.addEventListener('click', () => finish(cancelValue));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(cancelValue);
      });
      dialog.addEventListener('click', (event) => {
        // Clic en el backdrop: nunca confirma una operación.
        if (event.target === dialog) finish(cancelValue);
      });
      dialog.addEventListener('close', () => finish(cancelValue));
      if (input) {
        input.addEventListener('input', () => { error.hidden = true; });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); accept(); }
        });
      }
      document.body.append(dialog);
      try {
        dialog.showModal();
        // Nunca seleccionar por defecto el botón destructivo.
        if (input) input.focus();
        else if (btnCancel) btnCancel.focus();
        else btnOk.focus();
      } catch (_) {
        // Ante fallo del diálogo, abortar de forma segura.
        finish(cancelValue);
        if (typeof NotificationService !== 'undefined') {
          NotificationService.error('Confirmación no disponible', 'No se realizó ningún cambio. Actualiza la página e intenta nuevamente.');
        }
      }
    });
  }
  function schedule(kind, message, options = {}) {
    const run = queue.then(() => present({ kind, message, options }));
    // Serializa diálogos simultáneos; un rechazo no bloquea los siguientes.
    queue = run.then(() => undefined, () => undefined);
    return run;
  }
  return Object.freeze({
    confirm: (message, options = {}) => schedule('confirm', message, options),
    alert: (message, options = {}) => schedule('alert', message, options),
    prompt: (message, options = {}) => schedule('prompt', message, options),
  });
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
