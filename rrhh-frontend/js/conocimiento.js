// ==========================================
// js/conocimiento.js
// Controlador de Base de Conocimiento IA
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  if (!AuthService.estaAutenticado()) {
    window.location.replace("index.html");
    return;
  }

  const token = AuthService.obtenerToken();
  const usuario = AuthService.obtenerUsuario();
  if (usuario) {
    const infoAdmin = document.getElementById("info-admin");
    if (infoAdmin) {
      infoAdmin.innerHTML = `
        <span class="text-slate-400 font-medium">Bienvenido,</span>
        <span class="font-bold text-blue-950">${SecurityUtils.escapeHTML(usuario.nombre.split(" ")[0])}</span>
      `;
    }
  }

  document.getElementById("btn-logout")?.addEventListener("click", () => AuthService.cerrarSesion());

  const listaDocumentos = document.getElementById("lista-documentos");
  const formDocumento = document.getElementById("form-documento");
  const inputArchivo = document.getElementById("doc-archivo");
  const labelArchivo = document.getElementById("doc-nombre-archivo");
  const docProgreso = document.getElementById("doc-progreso");
  const btnSubir = document.getElementById("btn-subir-doc");
  const totalDocs = document.getElementById("total-docs");

  const chatMessages = document.getElementById("chat-preview-messages");
  const btnPreviewEnviar = document.getElementById("btn-preview-enviar");
  const inputPreviewPregunta = document.getElementById("preview-pregunta");

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    try { return { res, data: JSON.parse(text) }; } catch(e) { throw new Error(text); }
  }

  async function cargarDocumentos() {
    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.exito) {
        totalDocs.innerText = data.total;
        renderizarDocumentos(data.documentos);
      }
    } catch (e) {
      listaDocumentos.innerHTML = `<div class="p-5 text-center text-rose-500">Error al cargar documentos</div>`;
    }
  }

  function renderizarDocumentos(docs) {
    listaDocumentos.innerHTML = "";
    if (docs.length === 0) {
      listaDocumentos.innerHTML = `<div class="p-8 text-center text-slate-500">No hay documentos en la base de conocimiento.</div>`;
      return;
    }

    docs.forEach(doc => {
      const fecha = new Date(doc.fecha_actualizacion || new Date()).toLocaleDateString("es-ES");
      const idDocumento = Number(doc.id_documento) || 0;

      const div = document.createElement("div");
      div.className = "p-5 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors";
      div.innerHTML = `
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center text-lg border border-red-100 shrink-0">
            <i class="fa-solid fa-file-pdf"></i>
          </div>
          <div class="min-w-0">
            <h5 class="font-bold text-blue-950 truncate">${SecurityUtils.escapeHTML(doc.titulo)}</h5>
            <div class="flex items-center gap-3 mt-1">
              <span class="text-[10px] text-slate-400 font-medium"><i class="fa-regular fa-calendar mr-1"></i>${SecurityUtils.escapeHTML(fecha)}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${doc.tiene_archivo ? `
            <button type="button" data-id="${idDocumento}" class="btn-ver-doc px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all text-xs font-bold" title="Ver PDF">
              <i class="fa-solid fa-eye mr-1"></i>Ver PDF
            </button>` : ''}
          <button type="button" data-id="${idDocumento}" class="btn-eliminar-doc px-3 py-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all text-xs font-bold" title="Eliminar">
            <i class="fa-solid fa-trash-can mr-1"></i>Eliminar
          </button>
        </div>
      `;
      listaDocumentos.appendChild(div);
    });
  }

  inputArchivo.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      labelArchivo.innerHTML = `<span class="text-blue-600 font-bold"><i class="fa-solid fa-file-pdf mr-1"></i> ${SecurityUtils.escapeHTML(e.target.files[0].name)}</span>`;
    } else {
      labelArchivo.innerText = "Haz clic para seleccionar un PDF";
    }
  });

  formDocumento.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = document.getElementById("doc-titulo").value;
    const archivo = inputArchivo.files[0];

    if (!archivo) {
      NotificationService.warning("Falta el documento", "Selecciona un archivo PDF antes de continuar.");
      return;
    }

    const formData = new FormData();
    formData.append("titulo", titulo);
    formData.append("archivo_documento", archivo);

    btnSubir.disabled = true;
    docProgreso.classList.remove("hidden");

    try {
      const res = await fetch(`${CONFIG.API_URL}/admin/documentos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      
      if (res.ok && data.exito) {
        formDocumento.reset();
        labelArchivo.innerText = "Haz clic para seleccionar un PDF";
        await cargarDocumentos();
        NotificationService.success("Documento agregado", "El PDF ya forma parte de la base de conocimiento.");
      } else {
        NotificationService.apiError(res, data, "No fue posible subir el documento.");
      }
    } catch (error) {
      console.error("Error al subir documento:", error);
      NotificationService.error("No pudimos subir el documento", "Verifica tu conexión e intenta nuevamente.");
    } finally {
      btnSubir.disabled = false;
      docProgreso.classList.add("hidden");
    }
  });

  listaDocumentos.addEventListener("click", async (e) => {
    const btnVer = e.target.closest(".btn-ver-doc");
    if (btnVer) {
      const id = btnVer.dataset.id;
      try {
        const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos/${id}/url`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok || !data.exito) {
          NotificationService.apiError(res, data, "No fue posible obtener el documento.");
          return;
        }

        const urlSegura = SecurityUtils.safeHttpUrl(data.url);
        if (urlSegura === "#") {
          NotificationService.error("Documento no disponible", "La URL temporal generada no es válida.");
          return;
        }
        window.open(urlSegura, "_blank", "noopener,noreferrer");
      } catch (err) {
        console.error("Error al abrir documento:", err);
        NotificationService.error("No pudimos abrir el documento", "Intenta nuevamente en unos segundos.");
      }
      return;
    }

    const btnEliminar = e.target.closest(".btn-eliminar-doc");
    if (!btnEliminar) return;
    const id = btnEliminar.dataset.id;
    if (confirm("¿Estás seguro de eliminar este documento de la base de conocimiento? La IA ya no podrá consultarlo.")) {
      try {
        const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok || !data.exito) {
          NotificationService.apiError(res, data, "No fue posible eliminar el documento.");
          return;
        }
        await cargarDocumentos();
        NotificationService.success("Documento eliminado", "El documento fue retirado de la base de conocimiento.");
      } catch (err) {
        console.error("Error al eliminar documento:", err);
        NotificationService.error("No pudimos eliminar el documento", "Intenta nuevamente en unos segundos.");
      }
    }
  });


  // Chat Preview
  function addMessage(text, isUser = false) {
    const div = document.createElement("div");
    div.className = `p-3 rounded-2xl max-w-[85%] text-xs ${isUser ? 'bg-blue-600 text-white ml-auto rounded-tr-none' : 'bg-slate-100 text-slate-700 mr-auto rounded-tl-none'}`;
    div.innerText = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  btnPreviewEnviar.addEventListener("click", async () => {
    const pregunta = inputPreviewPregunta.value.trim();
    if (!pregunta) return;
    
    addMessage(pregunta, true);
    inputPreviewPregunta.value = "";
    
    const loadingId = "loading-" + Date.now();
    const div = document.createElement("div");
    div.id = loadingId;
    div.className = "p-3 rounded-2xl max-w-[85%] text-xs bg-slate-100 text-slate-700 mr-auto rounded-tl-none";
    div.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/empleados/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pregunta })
      });
      document.getElementById(loadingId).remove();
      if (data.exito) {
        addMessage(data.respuesta);
      } else {
        addMessage("Error: " + data.error);
      }
    } catch (e) {
      document.getElementById(loadingId).remove();
      addMessage("Error de conexión");
    }
  });

  cargarDocumentos();
});
