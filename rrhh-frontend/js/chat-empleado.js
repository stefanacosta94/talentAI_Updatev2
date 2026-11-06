// ==========================================
// js/chat-empleado.js
// Controlador de la interfaz del Asistente IA (RAG)
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  // 1. Validar Seguridad
  if (!AuthService.estaAutenticado()) {
    window.location.replace("index.html");
    return;
  }

  const usuario = AuthService.obtenerUsuario();
  const token = AuthService.obtenerToken();

  // Un solo chat de pantalla completa para empleados y administradores.
  // Las opciones CRUD solo se muestran a administradores; las rutas API aplican autorización real.
  if (AuthService.esAdmin()) {
    const sidebar = document.getElementById("admin-chat-sidebar");
    if (sidebar) sidebar.classList.add("md:flex");
    const adminName = document.getElementById("info-admin");
    if (adminName) adminName.textContent = usuario?.nombre || "Administrador";
  }

  // Mostrar nombre de la sesión
  if (usuario) {
    const infoEmpleado = document.getElementById("info-empleado-nombre");
    if (infoEmpleado)
      infoEmpleado.textContent = `Hola, ${usuario.nombre.split(" ")[0]}`;
  }

  // Cerrar sesión
  document
    .querySelectorAll("#btn-logout, #btn-logout-admin")
    .forEach((button) =>
      button.addEventListener("click", () => AuthService.cerrarSesion()),
    );

  // 2. Referencias del Chat
  const chatHistorial = document.getElementById("chat-historial");
  const formChat = document.getElementById("form-chat");
  const inputPregunta = document.getElementById("input-pregunta");
  const btnEnviar = document.getElementById("btn-enviar");
  const chipsSugerencia = document.querySelectorAll(".chip-sugerencia");
  const contenedorSugerencias = document.getElementById("sugerencias-chat");

  // Auto-ajustar altura del textarea
  inputPregunta.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height =
      (this.scrollHeight < 120 ? this.scrollHeight : 120) + "px";

    // Habilitar/deshabilitar botón
    btnEnviar.disabled = this.value.trim().length === 0;
  });

  // Enviar con Enter (sin Shift)
  inputPregunta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputPregunta.value.trim().length > 0) {
        formChat.dispatchEvent(new Event("submit"));
      }
    }
  });

  // Clic en chips de sugerencia
  chipsSugerencia.forEach((chip) => {
    chip.addEventListener("click", () => {
      inputPregunta.value = chip.textContent;
      inputPregunta.dispatchEvent(new Event("input")); // Disparar resize
      formChat.dispatchEvent(new Event("submit"));
    });
  });

  // 3. Funciones de Renderizado de Mensajes
  function agregarMensajeUsuario(texto) {
    const div = document.createElement("div");
    div.className = "flex items-end justify-end gap-3 w-full";
    const burbuja = document.createElement("div");
    burbuja.className =
      "bg-blue-600 px-5 py-3.5 rounded-2xl rounded-br-none text-sm text-white shadow-md max-w-[85%] whitespace-pre-wrap break-words";
    burbuja.textContent = texto;
    const avatar = document.createElement("div");
    avatar.className =
      "w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 shrink-0 text-xs font-bold";
    avatar.textContent = (usuario?.nombre || "U").charAt(0).toUpperCase();
    div.append(burbuja, avatar);
    chatHistorial.appendChild(div);
    hacerScrollAbajo();
  }

  function agregarMensajeIA(texto) {
    // No insertar HTML generado por el modelo: la salida de IA no es confiable.
    const div = document.createElement("div");
    div.className = "flex items-end gap-3 max-w-[92%]";
    const avatar = document.createElement("div");
    avatar.className =
      "w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0";
    avatar.innerHTML = '<i class="fa-solid fa-robot text-xs"></i>';
    const burbuja = document.createElement("div");
    burbuja.className =
      "bg-slate-50 border border-slate-100 px-5 py-3.5 rounded-2xl rounded-bl-none text-sm text-slate-700 shadow-sm leading-relaxed whitespace-pre-wrap break-words";
    // Formato limitado en texto: soporta **negritas**, sin interpretar HTML.
    String(texto ?? "")
      .split(/(\*\*[^*]+\*\*)/g)
      .forEach((fragmento) => {
        if (fragmento.startsWith("**") && fragmento.endsWith("**")) {
          const strong = document.createElement("strong");
          strong.textContent = fragmento.slice(2, -2);
          burbuja.appendChild(strong);
        } else burbuja.appendChild(document.createTextNode(fragmento));
      });
    div.append(avatar, burbuja);
    chatHistorial.appendChild(div);
    hacerScrollAbajo();
  }

  function mostrarIndicadorEscribiendo() {
    const div = document.createElement("div");
    div.id = "indicador-escribiendo";
    div.className = "flex items-end gap-3 max-w-[85%]";
    div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <i class="fa-solid fa-robot text-xs"></i>
            </div>
            <div class="bg-slate-50 border border-slate-100 px-5 py-4 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-1.5">
                <div class="w-2 h-2 bg-slate-300 rounded-full animate-bounce"></div>
                <div class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay: 0.15s"></div>
                <div class="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style="animation-delay: 0.3s"></div>
            </div>
        `;
    chatHistorial.appendChild(div);
    hacerScrollAbajo();
  }

  function removerIndicadorEscribiendo() {
    const indicador = document.getElementById("indicador-escribiendo");
    if (indicador) indicador.remove();
  }

  function hacerScrollAbajo() {
    chatHistorial.scrollTop = chatHistorial.scrollHeight;
  }

  // 4. Manejo del Envío del Formulario
  let consultaEnCurso = false;
  formChat.addEventListener("submit", async (e) => {
    e.preventDefault();

    const pregunta = inputPregunta.value.trim();
    if (!pregunta || consultaEnCurso) return;
    consultaEnCurso = true;

    // Ocultar sugerencias si es el primer mensaje
    if (contenedorSugerencias) contenedorSugerencias.style.display = "none";

    // Renderizar pregunta y limpiar input
    agregarMensajeUsuario(pregunta);
    inputPregunta.value = "";
    inputPregunta.style.height = "auto"; // Resetear altura
    btnEnviar.disabled = true;

    // Mostrar indicador de carga
    mostrarIndicadorEscribiendo();

    try {
      // NOTA: Verifica que esta ruta coincida con tu endpoint en index.js
      const respuesta = await fetch(`${CONFIG.API_URL}/empleados/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pregunta: pregunta }),
      });

      const data = await respuesta.json();
      removerIndicadorEscribiendo();

      if (!respuesta.ok || !data.exito) {
        const problema = new Error(
          data.error || "No se pudo obtener una respuesta.",
        );
        problema.status = respuesta.status;
        problema.codigo = data.codigo;
        throw problema;
      }

      // Mostrar respuesta de la IA
      agregarMensajeIA(data.respuesta);
      // Referencias devueltas por pgvector. Mostrar SOLO como texto, nunca HTML del documento.
      if (Array.isArray(data.fuentes) && data.fuentes.length) {
        const fuentes = document.createElement("div");
        fuentes.className =
          "ml-11 max-w-[85%] text-xs text-slate-500 border-l-2 border-blue-200 pl-3";
        fuentes.textContent =
          "Fuentes consultadas: " +
          data.fuentes
            .slice(0, 8)
            .map(
              (f) =>
                `${String(f.titulo || "Documento").slice(0, 100)} (fragmento ${Number(f.fragmento) || 1})`,
            )
            .join(" · ");
        chatHistorial.appendChild(fuentes);
        hacerScrollAbajo();
      }
    } catch (error) {
      removerIndicadorEscribiendo();
      // No ocultar denegaciones de permisos tras un mensaje genérico de conexión.
      const permisoDenegado = error.status === 401 || error.status === 403;
      const indisponible = error.status === 503;
      const sinIndice =
        error.codigo === "RAG_SIN_INDICE" ||
        error.codigo === "RAG_SIN_DOCUMENTOS";
      if (indisponible) {
        // Conservar la pregunta para reintento manual, sin generar otra petición automáticamente.
        inputPregunta.value = pregunta;
        inputPregunta.dispatchEvent(new Event("input"));
      }
      agregarMensajeIA(
        sinIndice
          ? error.message || "El índice documental no está preparado."
          : permisoDenegado
            ? error.message ||
              "No tienes acceso al asistente interno. Contacta a un administrador."
            : indisponible
              ? error.message ||
                "Gemini está temporalmente ocupado. Intenta nuevamente en unos segundos."
              : "No fue posible completar la consulta en este momento. Inténtalo nuevamente.",
      );
    } finally {
      consultaEnCurso = false;
      // Rehabilitar input
      inputPregunta.focus();
    }
  });

  // Iniciar con el botón deshabilitado
  btnEnviar.disabled = true;
});
