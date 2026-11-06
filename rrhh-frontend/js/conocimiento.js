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
  const editarModal = document.getElementById("modal-editar-documento");
  const editarForm = document.getElementById("form-editar-documento");
  const editarInput = document.getElementById("editar-documento-nombre");
  let documentosCargados = [];
  let documentoEditandoId = null;


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
        const estadoAuto = document.getElementById('estado-indexacion-auto');
        if (estadoAuto) estadoAuto.textContent = data.indexacion_automatica_habilitada
          ? 'Indexación automática activada' : 'Indexación automática desactivada (revisar .env)';
        documentosCargados = data.documentos || [];
        renderizarDocumentos(documentosCargados);
      }
    } catch (e) {
      listaDocumentos.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-rose-500">Error al cargar documentos</td></tr>`;
    }
  }

  function estadoIndexacion(indexacion) {
    const valor = String(indexacion?.estado || 'pendiente');
    const guardados = Number(indexacion?.fragmentos_guardados) || 0;
    const total = Number(indexacion?.fragmentos_total) || 0;
    const fraccion = total > 0 ? ` (${guardados}/${total})` : '';
    const etiquetas = {
      completado: ['Indexado', 'bg-emerald-50 text-emerald-700'],
      procesando: ['Indexando' + fraccion, 'bg-blue-50 text-blue-700'],
      parcial: ['En progreso' + fraccion, 'bg-blue-50 text-blue-700'],
      pendiente: ['En cola', 'bg-amber-50 text-amber-700'],
      error: ['Reintento programado' + fraccion, 'bg-amber-50 text-amber-700'],
      pausado: ['Requiere revisión' + fraccion, 'bg-rose-50 text-rose-700']
    };
    const [texto, clases] = etiquetas[valor] || ['Desconocido', 'bg-slate-50 text-slate-500'];
    return `<span class="inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${clases}">${SecurityUtils.escapeHTML(texto)}</span>`;
  }

  function renderizarDocumentos(docs) {
    if (!docs.length) {
      listaDocumentos.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500">No hay documentos registrados.</td></tr>';
      return;
    }
    listaDocumentos.innerHTML = docs.map(doc => {
      const fecha = doc.fecha_actualizacion ? new Date(doc.fecha_actualizacion).toLocaleDateString("es-HN") : "Sin fecha";
      const id = Number(doc.id_documento);
      return `<tr class="border-b border-slate-100 hover:bg-slate-50/60">
        <td class="p-4 font-bold text-blue-950"><i class="fa-solid fa-file-pdf mr-2 text-rose-600"></i>${SecurityUtils.escapeHTML(doc.titulo)}</td>
        <td class="p-4 text-slate-500 whitespace-nowrap">${SecurityUtils.escapeHTML(fecha)}</td>
        <td class="p-4">${estadoIndexacion(doc.indexacion)}</td>
        <td class="p-4 text-right whitespace-nowrap">
          ${["error", "pausado"].includes(doc.indexacion?.estado) ? `<button data-id="${id}" class="btn-reintentar-indice px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold" title="Reprogramar indexación">Reintentar índice</button>` : ""}
          ${doc.tiene_archivo ? `<button data-id="${id}" class="btn-ver-doc px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold" title="Ver PDF">Ver PDF</button>` : ""}
          <button data-id="${id}" class="btn-editar-doc px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold" title="Editar título">Editar</button>
          <button data-id="${id}" class="btn-eliminar-doc px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold" title="Eliminar">Eliminar</button>
        </td>
      </tr>`;
    }).join("");
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
        NotificationService.success("Documento agregado", "PDF almacenado. Su indexación semántica se realizará en segundo plano.");
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
    const btnReintentar = e.target.closest('.btn-reintentar-indice');
    if (btnReintentar) {
      try {
        const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos/${btnReintentar.dataset.id}/indexacion/reintentar`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok || !data.exito) return NotificationService.apiError(res, data, 'No fue posible reprogramar el índice.');
        NotificationService.success('Índice reprogramado', 'Se procesará por lotes cuando el trabajador esté activo.');
        await cargarDocumentos();
      } catch (_) { NotificationService.error('Error de conexión', 'No fue posible reprogramar el índice.'); }
      return;
    }
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

    const btnEditar = e.target.closest(".btn-editar-doc");
    if (btnEditar) {
      const doc = documentosCargados.find(d => String(d.id_documento) === btnEditar.dataset.id);
      if (!doc) return;
      documentoEditandoId = doc.id_documento;
      editarInput.value = doc.titulo;
      document.getElementById("editar-documento-pdf").value = "";
      editarModal.classList.remove("hidden");
      editarInput.focus();
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


  document.getElementById("btn-cancelar-editar-documento")?.addEventListener("click", () => {
    editarModal.classList.add("hidden");
    documentoEditandoId = null;
  });
  editarForm?.addEventListener("submit", async e => {
    e.preventDefault();
    if (documentoEditandoId == null) return;
    const titulo = editarInput.value.trim();
    if (!titulo) return NotificationService.warning("Título obligatorio", "Indica un nombre para el documento.");
    try {
      const archivo = document.getElementById("editar-documento-pdf").files[0];
      if (archivo && (archivo.size > 5 * 1024 * 1024 || archivo.type !== "application/pdf")) {
        return NotificationService.warning("PDF inválido", "Selecciona un PDF válido de hasta 5 MB.");
      }
      const payload = new FormData();
      payload.append("titulo", titulo);
      if (archivo) payload.append("archivo_documento", archivo);
      const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos/${documentoEditandoId}`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}` },
        body: payload
      });
      if (!res.ok || !data.exito) return NotificationService.apiError(res, data, "No se pudo editar el título.");
      editarModal.classList.add("hidden");
      documentoEditandoId = null;
      NotificationService.success("Documento actualizado", "Los cambios se guardaron correctamente.");
      await cargarDocumentos();
    } catch (_) { NotificationService.error("Sin conexión", "No fue posible guardar los cambios."); }
  });

  document.getElementById('btn-recargar-indices')?.addEventListener('click', cargarDocumentos);
  // La tabla se refresca mientras la pantalla está visible, sin consultar embeddings.
  setInterval(() => { if (document.visibilityState === 'visible') cargarDocumentos(); }, 60000);
  cargarDocumentos();
});
