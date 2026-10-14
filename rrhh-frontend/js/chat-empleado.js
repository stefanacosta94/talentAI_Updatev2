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

    // Mostrar nombre del empleado
    if (usuario) {
        const infoEmpleado = document.getElementById("info-empleado-nombre");
        if (infoEmpleado) infoEmpleado.textContent = `Hola, ${usuario.nombre.split(" ")[0]}`;
    }

    // Cerrar sesión
    document.getElementById("btn-logout")?.addEventListener("click", () => AuthService.cerrarSesion());

    // 2. Referencias del Chat
    const chatHistorial = document.getElementById("chat-historial");
    const formChat = document.getElementById("form-chat");
    const inputPregunta = document.getElementById("input-pregunta");
    const btnEnviar = document.getElementById("btn-enviar");
    const chipsSugerencia = document.querySelectorAll(".chip-sugerencia");
    const contenedorSugerencias = document.getElementById("sugerencias-chat");

    // Auto-ajustar altura del textarea
    inputPregunta.addEventListener("input", function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight < 120 ? this.scrollHeight : 120) + 'px';
        
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
    chipsSugerencia.forEach(chip => {
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
        div.innerHTML = `
            <div class="bg-blue-600 px-5 py-3.5 rounded-2xl rounded-br-none text-sm text-white shadow-md max-w-[85%]">
                ${texto.replace(/\n/g, '<br>')}
            </div>
            <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 shrink-0 text-xs font-bold">
                ${usuario.nombre.charAt(0).toUpperCase()}
            </div>
        `;
        chatHistorial.appendChild(div);
        hacerScrollAbajo();
    }

    function agregarMensajeIA(texto) {
        // Formatear markdown básico (negritas y saltos de línea)
        let textoFormateado = texto.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        textoFormateado = textoFormateado.replace(/\n/g, '<br>');

        const div = document.createElement("div");
        div.className = "flex items-end gap-3 max-w-[85%]";
        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <i class="fa-solid fa-robot text-xs"></i>
            </div>
            <div class="bg-slate-50 border border-slate-100 px-5 py-3.5 rounded-2xl rounded-bl-none text-sm text-slate-700 shadow-sm leading-relaxed">
                ${textoFormateado}
            </div>
        `;
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
    formChat.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const pregunta = inputPregunta.value.trim();
        if (!pregunta) return;

        // Ocultar sugerencias si es el primer mensaje
        if (contenedorSugerencias) contenedorSugerencias.style.display = 'none';

        // Renderizar pregunta y limpiar input
        agregarMensajeUsuario(pregunta);
        inputPregunta.value = "";
        inputPregunta.style.height = 'auto'; // Resetear altura
        btnEnviar.disabled = true;

        // Mostrar indicador de carga
        mostrarIndicadorEscribiendo();

        try {
            // NOTA: Verifica que esta ruta coincida con tu endpoint en index.js
            const respuesta = await fetch(`${CONFIG.API_URL}/empleados/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ pregunta: pregunta })
            });

            const data = await respuesta.json();
            removerIndicadorEscribiendo();

            if (!respuesta.ok || !data.exito) {
                throw new Error(data.error || "No se pudo obtener una respuesta.");
            }

            // Mostrar respuesta de la IA
            agregarMensajeIA(data.respuesta);

        } catch (error) {
            removerIndicadorEscribiendo();
            agregarMensajeIA(`❌ **Error de conexión:** No pude comunicarme con el servidor. Por favor, intenta de nuevo más tarde.\nDetalle: ${error.message}`);
        } finally {
            // Rehabilitar input
            inputPregunta.focus();
        }
    });

    // Iniciar con el botón deshabilitado
    btnEnviar.disabled = true;
});