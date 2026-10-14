// ==========================================
// js/candidatos.js
// Controlador de la tabla ATS y modales
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  if (!AuthService.estaAutenticado()) {
    window.location.replace("index.html");
    return;
  }

  const token = AuthService.obtenerToken();
  // Renderizar nombre del administrador y vincular logout
  const usuario = AuthService.obtenerUsuario();
  if (usuario) {
    const primerNombre = usuario.nombre.split(" ")[0];
    const infoAdmin = document.getElementById("info-admin");
    if (infoAdmin) {
      infoAdmin.innerHTML = `
                <span class="text-slate-400 font-medium">Bienvenido,</span>
                <span class="font-bold text-blue-950">${SecurityUtils.escapeHTML(primerNombre)}</span>
            `;
    }
  }

  const btnLogout = document.getElementById("btn-logout");
  btnLogout?.addEventListener("click", () => AuthService.cerrarSesion());
  const tablaCandidatosBody = document.getElementById("tabla-candidatos-body");
  const inputBuscador = document.querySelector("header input[type='text']");

  // Referencias del Modal
  const modalDetalle = document.getElementById("modal-detalle-candidato");
  const btnCerrarModal = document.getElementById("btn-cerrar-modal-candidato");

  let aplicacionesGlobales = [];
  let aplicacionActualId = null;

  // 1. Cargar Aplicaciones desde el Backend
  async function cargarAplicacionesATS() {
    try {
      const respuesta = await fetch(`${CONFIG.API_URL}/admin/aplicaciones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await respuesta.json();

      if (!respuesta.ok || !data.exito) throw new Error(data.error);

      aplicacionesGlobales = data.aplicaciones;
      renderizarTabla(aplicacionesGlobales);
    } catch (err) {
      console.error("Error al cargar aplicaciones:", err);
      tablaCandidatosBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-rose-500 font-medium">Error al cargar los datos del ATS.</td></tr>`;
    }
  }

  // 2. Renderizar la Tabla
  function renderizarTabla(aplicaciones) {
    tablaCandidatosBody.innerHTML = "";

    if (aplicaciones.length === 0) {
      tablaCandidatosBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 font-medium">No hay candidatos postulados todavía.</td></tr>`;
      return;
    }

    aplicaciones.forEach((app) => {
      const candidato = app.candidatos || {
        nombre: "Desconocido",
        correo: "N/A",
      };
      const vacante = app.vacantes || {
        titulo: "Vacante no disponible",
        departamentos: { nombre: "General" },
      };
      const deptoNombre = vacante.departamentos?.nombre || "General";

      // Color dinámico para el porcentaje de Match de IA
      const matchScore = app.ai_match_score || 0;
      let badgeColor = "bg-slate-100 text-slate-700 border-slate-200";
      if (matchScore >= 75)
        badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
      else if (matchScore >= 50)
        badgeColor = "bg-blue-50 text-blue-700 border-blue-200";
      else if (matchScore > 0)
        badgeColor = "bg-orange-50 text-orange-700 border-orange-200";

      // Color para el estado del proceso
      let estadoColor = "bg-slate-100 text-slate-600 border-slate-200";
      if (app.estado_proceso === "Contratado")
        estadoColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
      else if (app.estado_proceso === "Entrevista")
        estadoColor = "bg-purple-50 text-purple-700 border-purple-200";
      else if (app.estado_proceso === "En Revisión")
        estadoColor = "bg-blue-50 text-blue-700 border-blue-200";
      else if (app.estado_proceso === "Descartado")
        estadoColor = "bg-rose-50 text-rose-700 border-rose-200";

      const tr = document.createElement("tr");
      tr.className =
        "hover:bg-slate-50/80 transition-colors border-b border-slate-100";
      tr.innerHTML = `
                <td class="py-4 px-6">
                    <p class="font-bold text-blue-950">${SecurityUtils.escapeHTML(candidato.nombre)}</p>
                    <p class="text-xs text-slate-400">${SecurityUtils.escapeHTML(candidato.correo)}</p>
                </td>
                <td class="py-4 px-6">
                    <p class="font-semibold text-slate-800">${SecurityUtils.escapeHTML(vacante.titulo)}</p>
                    <span class="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">${SecurityUtils.escapeHTML(deptoNombre)}</span>
                </td>
                <td class="py-4 px-6">
                    <span class="px-3 py-1 rounded-full font-black text-xs border ${badgeColor}">
                        ${matchScore}% Match
                    </span>
                </td>
                <td class="py-4 px-6">
                    <span class="px-3 py-1 rounded-full font-bold text-[11px] border ${estadoColor}">
                        ${SecurityUtils.escapeHTML(app.estado_proceso || "Recibida")}
                    </span>
                </td>
                <td class="py-4 px-6 text-right">
                    <button onclick="abrirDetalleCandidato(${Number(app.id_aplicacion) || 0})" class="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition-all text-xs">
                        <i class="fa-solid fa-eye mr-1"></i> Ver Detalle
                    </button>
                </td>
            `;
      tablaCandidatosBody.appendChild(tr);
    });
  }

  // 3. Abrir Modal de Detalle
  window.abrirDetalleCandidato = function (idAplicacion) {
    const app = aplicacionesGlobales.find(
      (a) => Number(a.id_aplicacion) === Number(idAplicacion),
    );
    if (!app) return;

    aplicacionActualId = app.id_aplicacion;
    const candidato = app.candidatos || {};
    const vacante = app.vacantes || {};

    document.getElementById("modal-nombre-candidato").textContent =
      candidato.nombre || "Sin nombre";
    document.getElementById("modal-correo-candidato").textContent =
      candidato.correo || "Sin correo";
    document.getElementById("modal-telefono-candidato").textContent =
      candidato.telefono || "No proporcionado";
    document.getElementById("modal-vacante-candidato").textContent =
      vacante.titulo || "Puesto general";
    document.getElementById("modal-resumen-ia").textContent =
      app.ai_resumen_habilidades ||
      "No hay análisis de IA disponible para este perfil.";

    const linkCv = document.getElementById("modal-link-cv");
    if (app.tiene_cv) {
      linkCv.href = "#";
      linkCv.dataset.aplicacionId = String(app.id_aplicacion);
      linkCv.classList.remove("hidden");
    } else {
      linkCv.removeAttribute("data-aplicacion-id");
      linkCv.classList.add("hidden");
    }

    modalDetalle.classList.remove("hidden");
  };

  document.getElementById("modal-link-cv")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const idAplicacion = e.currentTarget.dataset.aplicacionId;
    if (!idAplicacion) return;

    try {
      const respuesta = await fetch(`${CONFIG.API_URL}/admin/aplicaciones/${idAplicacion}/cv-url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await respuesta.json();
      if (!respuesta.ok || !data.exito) {
        NotificationService.apiError(respuesta, data, "No fue posible obtener el CV.");
        return;
      }

      const urlSegura = SecurityUtils.safeHttpUrl(data.url);
      if (urlSegura === "#") {
        NotificationService.error("CV no disponible", "La URL temporal generada no es válida.");
        return;
      }
      window.open(urlSegura, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error al abrir CV:", err);
      NotificationService.error("No pudimos abrir el CV", "Intenta nuevamente en unos segundos.");
    }
  });

  // 4. Cambiar Estado del Proceso
  window.actualizarEstadoProceso = async function (nuevoEstado) {
    if (!aplicacionActualId) return;

    try {
      const respuesta = await fetch(
        `${CONFIG.API_URL}/admin/aplicaciones/${aplicacionActualId}/estado`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ estado_proceso: nuevoEstado }),
        },
      );

      const data = await respuesta.json();
      if (!respuesta.ok || !data.exito) {
        NotificationService.apiError(respuesta, data, "No fue posible actualizar el estado.");
        return;
      }

      modalDetalle.classList.add("hidden");
      await cargarAplicacionesATS();
      NotificationService.success("Estado actualizado", `La candidatura ahora está en "${nuevoEstado}".`);
    } catch (err) {
      console.error("Error al actualizar estado ATS:", err);
      NotificationService.error("No pudimos actualizar el estado", "Intenta nuevamente en unos segundos.");
    }
  };

  // 5. Filtrado en tiempo real con la barra de búsqueda superior
  inputBuscador?.addEventListener("input", (e) => {
    const textoBusqueda = e.target.value.toLowerCase().trim();
    const filtradas = aplicacionesGlobales.filter((app) => {
      const nombreCand = app.candidatos?.nombre?.toLowerCase() || "";
      const correoCand = app.candidatos?.correo?.toLowerCase() || "";
      const tituloVac = app.vacantes?.titulo?.toLowerCase() || "";

      return (
        nombreCand.includes(textoBusqueda) ||
        correoCand.includes(textoBusqueda) ||
        tituloVac.includes(textoBusqueda)
      );
    });
    renderizarTabla(filtradas);
  });

  // Controladores de cierre de modal
  const cerrarModal = () => modalDetalle.classList.add("hidden");
  btnCerrarModal?.addEventListener("click", cerrarModal);

  // Cerrar modal haciendo clic fuera de él (opcional pero muy útil)
  modalDetalle?.addEventListener("click", (e) => {
    if (e.target === modalDetalle) cerrarModal();
  });

  // Cargar al iniciar
  cargarAplicacionesATS();
});
