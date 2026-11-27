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
  const inputBuscador = document.getElementById("buscador-ats");
  const filtroEstado = document.getElementById("filtro-estado-ats");
  const tamanoPagina = document.getElementById("tamano-pagina-ats");
  const btnAnterior = document.getElementById("btn-pagina-anterior-ats");
  const btnSiguiente = document.getElementById("btn-pagina-siguiente-ats");
  const resumenPaginacion = document.getElementById("resumen-paginacion-ats");
  const indicadorPagina = document.getElementById("indicador-pagina-ats");
  const btnLimpiarFiltros = document.getElementById("btn-limpiar-filtros-ats");
  const btnActualizarAts = document.getElementById("btn-actualizar-ats");
  const estadoActualizacionIA = document.getElementById("ats-estado-actualizacion-ia");

  // Referencias del Modal
  const modalDetalle = document.getElementById("modal-detalle-candidato");
  const btnCerrarModal = document.getElementById("btn-cerrar-modal-candidato");

  let aplicacionesGlobales = []; // Solo la página actual; nunca todo el conjunto.
  let aplicacionActualId = null;
  const filtros = { pagina: 1, limite: 20, busqueda: "", estado: "" };
  let controladorCarga = null;
  let numeroSolicitud = 0;
  let temporizadorBusqueda = null;
  let anteriorFocoModal = null;
  let actualizandoEstado = false;
  // Refresco limitado: solo si la página actual incluye evaluaciones sin resultado.
  // El estado del worker no se expone en este listado: sin score = resultado pendiente,
  // no una garantía de que Gemini esté procesando en este instante.
  const INTERVALO_REFRESCO_IA_MS = 15000;
  const MAX_REFRESCOS_IA = 40;
  let temporizadorRefrescoIA = null;
  let refrescosIA = 0;
  let pendientesIAVisibles = false;
  let seguimientoIAIniciado = false;
  let firmaPaginaAnterior = null;
  let paginaCerrandose = false;

  const sinPuntajeIA = aplicacion => aplicacion.ai_match_score == null ||
    !Number.isFinite(Number(aplicacion.ai_match_score));

  function escribirEstadoIA(mensaje, variante = "") {
    if (!estadoActualizacionIA) return;
    estadoActualizacionIA.textContent = mensaje;
    estadoActualizacionIA.dataset.estado = variante;
    estadoActualizacionIA.classList.toggle("hidden", !mensaje);
  }

  function cancelarRefrescoIA() {
    if (temporizadorRefrescoIA !== null) clearTimeout(temporizadorRefrescoIA);
    temporizadorRefrescoIA = null;
  }

  function reiniciarSeguimientoIA() {
    cancelarRefrescoIA();
    refrescosIA = 0;
    pendientesIAVisibles = false;
    seguimientoIAIniciado = false;
    firmaPaginaAnterior = null;
    escribirEstadoIA("");
  }

  function programarRefrescoIA() {
    cancelarRefrescoIA();
    if (!pendientesIAVisibles || paginaCerrandose) return;
    if (refrescosIA >= MAX_REFRESCOS_IA) {
      escribirEstadoIA("La evaluación sigue pendiente. Pulsa «Actualizar» para comprobar su estado.", "advertencia");
      return;
    }
    if (document.hidden) {
      escribirEstadoIA("Actualización automática pausada mientras la pestaña está oculta.", "pausada");
      return;
    }
    escribirEstadoIA("Evaluación IA en proceso · comprobación automática cada 15 segundos.", "activo");
    temporizadorRefrescoIA = setTimeout(() => {
      temporizadorRefrescoIA = null;
      if (paginaCerrandose || document.hidden) return;
      if (actualizandoEstado) { programarRefrescoIA(); return; }
      refrescosIA += 1;
      cargarAplicacionesATS({ silenciosa: true });
    }, INTERVALO_REFRESCO_IA_MS);
  }

  function reconciliarSeguimientoIA(aplicaciones) {
    const habiaPendientes = pendientesIAVisibles;
    pendientesIAVisibles = aplicaciones.some(sinPuntajeIA);
    if (!pendientesIAVisibles) {
      cancelarRefrescoIA();
      if (habiaPendientes || seguimientoIAIniciado) {
        escribirEstadoIA("Las evaluaciones de esta página ya tienen resultado.", "completado");
      } else escribirEstadoIA("");
      seguimientoIAIniciado = false;
      refrescosIA = 0;
      return;
    }
    seguimientoIAIniciado = true;
    programarRefrescoIA();
  }

  function firmaAplicaciones(aplicaciones, total) {
    // Evita reconstruir el DOM cada 15 s si el backend devuelve los mismos datos.
    return JSON.stringify({ total, aplicaciones });
  }

  function actualizarDetalleIA(app) {
    if (!app) return;
    const pendiente = sinPuntajeIA(app);
    const score = pendiente ? null : Math.max(0, Math.min(100, Number(app.ai_match_score)));
    document.getElementById("modal-match-candidato").textContent = pendiente ? "En proceso" : `${score}%`;
    const barra = document.getElementById("modal-match-barra");
    if (pendiente) barra.removeAttribute("aria-valuenow");
    else barra.setAttribute("aria-valuenow", String(score));
    barra.setAttribute("aria-valuetext", pendiente ? "Evaluación IA pendiente de resultado" : `${score} por ciento`);
    document.getElementById("modal-match-relleno").style.width = `${score ?? 0}%`;
    document.getElementById("modal-ayuda-ia").textContent = pendiente
      ? "La evaluación IA está pendiente de resultado. Se comprobará automáticamente mientras esta página siga abierta."
      : "Evaluación orientativa basada en el CV y los requisitos; requiere revisión humana.";
    document.getElementById("modal-resumen-ia").textContent = app.ai_resumen_habilidades ||
      (pendiente ? "La candidatura está registrada. La evaluación puede tardar o requerir revisión técnica si permanece pendiente." :
        "No hay análisis de IA disponible para este perfil.");
  }

  function actualizarFiltrosActivos() {
    const activos = Boolean(filtros.busqueda || filtros.estado);
    if (btnLimpiarFiltros) btnLimpiarFiltros.disabled = !activos;
  }

  function actualizarIndicadoresPagina(aplicaciones) {
    const evaluadas = aplicaciones
      .filter(a => !sinPuntajeIA(a))
      .map(a => Number(a.ai_match_score));
    document.getElementById("ats-visibles").textContent = String(aplicaciones.length);
    document.getElementById("ats-pendientes-ia").textContent = String(aplicaciones.length - evaluadas.length);
    document.getElementById("ats-promedio-pagina").textContent = evaluadas.length
      ? `${Math.round(evaluadas.reduce((suma, valor) => suma + valor, 0) / evaluadas.length)}%` : "—";
    actualizarFiltrosActivos();
  }

  function actualizarPaginacion(total = 0, paginas = 0, cargando = false) {
    const desde = total === 0 ? 0 : (filtros.pagina - 1) * filtros.limite + 1;
    const hasta = Math.min(total, filtros.pagina * filtros.limite);
    resumenPaginacion.textContent = cargando
      ? "Consultando candidaturas..."
      : `Mostrando ${desde}–${hasta} de ${total} postulaciones`;
    indicadorPagina.textContent = `Página ${filtros.pagina} de ${Math.max(1, paginas)}`;
    btnAnterior.disabled = cargando || filtros.pagina <= 1;
    btnSiguiente.disabled = cargando || filtros.pagina >= paginas;
  }

  // La búsqueda, el filtrado y el COUNT se ejecutan en Supabase, antes del LIMIT.
  async function cargarAplicacionesATS({ silenciosa = false } = {}) {
    cancelarRefrescoIA();
    if (!silenciosa) reiniciarSeguimientoIA();
    controladorCarga?.abort();
    const controller = new AbortController();
    controladorCarga = controller;
    const solicitud = ++numeroSolicitud;
    if (!silenciosa) {
      actualizarPaginacion(0, 0, true);
      tablaCandidatosBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 font-medium"><i class="fa-solid fa-circle-notch fa-spin mr-2" aria-hidden="true"></i> Consultando postulaciones...</td></tr>`;
    }
    if (btnActualizarAts) btnActualizarAts.disabled = true;
    try {
      const params = new URLSearchParams({ pagina: String(filtros.pagina), limite: String(filtros.limite) });
      if (filtros.busqueda) params.set("busqueda", filtros.busqueda);
      if (filtros.estado) params.set("estado", filtros.estado);
      const respuesta = await fetch(`${CONFIG.API_URL}/admin/aplicaciones?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const data = await respuesta.json();
      if (!respuesta.ok || !data.exito) throw new Error(data.error || "No fue posible consultar el ATS.");
      if (solicitud !== numeroSolicitud) return;

      const total = Number(data.total) || 0;
      const paginas = Math.ceil(total / filtros.limite);
      if (filtros.pagina > Math.max(1, paginas)) {
        filtros.pagina = Math.max(1, paginas);
        return cargarAplicacionesATS();
      }
      const nuevasAplicaciones = Array.isArray(data.aplicaciones) ? data.aplicaciones : [];
      const nuevaFirma = firmaAplicaciones(nuevasAplicaciones, total);
      const cambioVisible = !silenciosa || firmaPaginaAnterior !== nuevaFirma;
      // Eliminar el foco del botón de detalle nunca es necesario cuando nada cambió.
      const focoAnterior = cambioVisible && silenciosa
        ? document.activeElement?.closest('#tabla-candidatos-body button[data-aplicacion-id]')?.dataset.aplicacionId
        : null;
      aplicacionesGlobales = nuevasAplicaciones;
      if (cambioVisible) {
        renderizarTabla(aplicacionesGlobales);
        actualizarIndicadoresPagina(aplicacionesGlobales);
        actualizarPaginacion(total, paginas);
        if (focoAnterior) {
          [...tablaCandidatosBody.querySelectorAll('button[data-aplicacion-id]')]
            .find(b => b.dataset.aplicacionId === focoAnterior)?.focus();
        }
        // Si el detalle estaba abierto, actualizar también su análisis sin cerrarlo.
        if (aplicacionActualId != null && !modalDetalle.classList.contains("hidden")) {
          actualizarDetalleIA(aplicacionesGlobales.find(a => Number(a.id_aplicacion) === Number(aplicacionActualId)));
        }
      }
      firmaPaginaAnterior = nuevaFirma;
      reconciliarSeguimientoIA(aplicacionesGlobales);
    } catch (err) {
      if (controller.signal.aborted || solicitud !== numeroSolicitud) return;
      console.error("Error al cargar aplicaciones:", err);
      if (silenciosa) {
        escribirEstadoIA("No se pudo comprobar el resultado IA. Se intentará de nuevo automáticamente.", "advertencia");
        if (pendientesIAVisibles && refrescosIA < MAX_REFRESCOS_IA && !document.hidden) {
          temporizadorRefrescoIA = setTimeout(() => {
            temporizadorRefrescoIA = null;
            refrescosIA += 1;
            cargarAplicacionesATS({ silenciosa: true });
          }, INTERVALO_REFRESCO_IA_MS);
        }
        return;
      }
      aplicacionesGlobales = [];
      actualizarIndicadoresPagina([]);
      tablaCandidatosBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-rose-600 font-medium">No fue posible cargar las postulaciones. Vuelve a intentar.</td></tr>`;
      resumenPaginacion.textContent = "Error de consulta";
      indicadorPagina.textContent = "—";
      btnAnterior.disabled = true;
      btnSiguiente.disabled = true;
    } finally {
      if (solicitud === numeroSolicitud && btnActualizarAts) btnActualizarAts.disabled = false;
    }
  }

  // 2. Renderizar la Tabla
  function renderizarTabla(aplicaciones) {
    tablaCandidatosBody.innerHTML = "";

    if (aplicaciones.length === 0) {
      tablaCandidatosBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 font-medium">No se encontraron postulaciones para los filtros seleccionados.</td></tr>`;
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
      const pendienteIA = sinPuntajeIA(app);
      const matchScore = pendienteIA ? null : Math.max(0, Math.min(100, Number(app.ai_match_score)));
      let badgeColor = "bg-slate-100 text-slate-700 border-slate-200";
      if (!pendienteIA && matchScore >= 75)
        badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
      else if (!pendienteIA && matchScore >= 50)
        badgeColor = "bg-blue-50 text-blue-700 border-blue-200";
      else if (!pendienteIA && matchScore > 0)
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
                    <div class="ats-match-cell">
                      <span class="px-3 py-1 rounded-full font-black text-xs border ${badgeColor} ${pendienteIA ? 'ats-match-pending' : ''}">
                        ${pendienteIA ? '<i class="fa-solid fa-circle-notch fa-spin mr-1" aria-hidden="true"></i> Evaluación IA en proceso' : `${matchScore}% Match`}
                      </span>
                      ${pendienteIA ? '<small class="ats-match-helper">Resultado pendiente; actualización automática</small>' : `<div class="ats-match-track" role="progressbar" aria-label="Coincidencia IA: ${matchScore}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${matchScore}"><span style="width:${matchScore}%"></span></div>`}
                    </div>
                </td>
                <td class="py-4 px-6">
                    <span class="px-3 py-1 rounded-full font-bold text-[11px] border ${estadoColor}">
                        ${SecurityUtils.escapeHTML(app.estado_proceso || "Recibida")}
                    </span>
                </td>
                <td class="py-4 px-6 text-right">
                    <button data-aplicacion-id="${Number(app.id_aplicacion) || 0}" onclick="abrirDetalleCandidato(${Number(app.id_aplicacion) || 0})" class="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition-all text-xs">
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
    const permitidas = new Set(app.transiciones_permitidas || []);
    document.querySelectorAll('#botones-estado-container button[data-nuevo-estado]').forEach(boton => {
      const puedeCambiar = permitidas.has(boton.dataset.nuevoEstado);
      boton.disabled = !puedeCambiar;
      boton.classList.toggle('opacity-40', !puedeCambiar);
      boton.classList.toggle('cursor-not-allowed', !puedeCambiar);
      boton.title = puedeCambiar ? `Cambiar a ${boton.dataset.nuevoEstado}` : 'Transición no permitida desde el estado actual';
    });
    document.getElementById('aviso-estado-terminal')?.classList.toggle('hidden', permitidas.size > 0);
    document.getElementById("estado-actual-candidato").textContent = `Estado actual: ${app.estado_proceso || "Recibida"}`;
    actualizarDetalleIA(app);
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

    const linkCv = document.getElementById("modal-link-cv");
    if (app.tiene_cv) {
      linkCv.href = "#";
      linkCv.dataset.aplicacionId = String(app.id_aplicacion);
      linkCv.classList.remove("hidden");
    } else {
      linkCv.removeAttribute("data-aplicacion-id");
      linkCv.classList.add("hidden");
    }

    anteriorFocoModal = document.activeElement;
    modalDetalle.classList.remove("hidden");
    btnCerrarModal?.focus();
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

  // 4. Cambios de etapa: se respetan las transiciones del backend y se bloquea el doble envío.
  window.actualizarEstadoProceso = async function (nuevoEstado) {
    if (!aplicacionActualId || actualizandoEstado) return;
    const app = aplicacionesGlobales.find(a => Number(a.id_aplicacion) === Number(aplicacionActualId));
    if (!app || !Array.isArray(app.transiciones_permitidas) || !app.transiciones_permitidas.includes(nuevoEstado)) {
      NotificationService.error("Transición no permitida", "Actualiza el listado y revisa el estado de la candidatura.");
      return;
    }
    // Solo las decisiones finales requieren esta confirmación adicional en UX.
    if (["Contratado", "Descartado"].includes(nuevoEstado)) {
      const confirmado = await DialogService.confirm(
        `La candidatura pasará a «${nuevoEstado}», un estado final que no permite nuevas transiciones desde este panel. ¿Confirmas esta decisión?`,
        { title: "Confirmar decisión final", variant: "warning", confirmText: `Confirmar ${nuevoEstado}` },
      );
      if (!confirmado || aplicacionActualId !== app.id_aplicacion) return;
    }
    actualizandoEstado = true;
    const botones = [...document.querySelectorAll('#botones-estado-container button[data-nuevo-estado]')];
    botones.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    try {
      const respuesta = await fetch(`${CONFIG.API_URL}/admin/aplicaciones/${aplicacionActualId}/estado`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ estado_proceso: nuevoEstado }),
      });
      const data = await respuesta.json();
      if (!respuesta.ok || !data.exito) {
        NotificationService.apiError(respuesta, data, "No fue posible actualizar el estado.");
        return;
      }
      cerrarModal(true);
      await cargarAplicacionesATS();
      NotificationService.success("Estado actualizado", `La candidatura ahora está en "${nuevoEstado}".`);
    } catch (err) {
      console.error("Error al actualizar estado ATS:", err);
      NotificationService.error("No pudimos actualizar el estado", "Intenta nuevamente en unos segundos.");
    } finally {
      actualizandoEstado = false;
      botones.forEach(b => b.removeAttribute('aria-busy'));
      // Mantener la política de transiciones al reabrir, incluso después de un error.
      const vigente = aplicacionesGlobales.find(a => Number(a.id_aplicacion) === Number(aplicacionActualId));
      const permitidas = new Set(vigente?.transiciones_permitidas || []);
      botones.forEach(b => { b.disabled = !permitidas.has(b.dataset.nuevoEstado); });
    }
  };

  // 5. Búsqueda paginada con debounce y cancelación de solicitudes anteriores.
  inputBuscador?.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => {
      filtros.busqueda = inputBuscador.value.trim().slice(0, 100);
      filtros.pagina = 1;
      cargarAplicacionesATS();
    }, 350);
  });
  filtroEstado?.addEventListener("change", () => {
    filtros.estado = filtroEstado.value;
    filtros.pagina = 1;
    cargarAplicacionesATS();
  });
  tamanoPagina?.addEventListener("change", () => {
    filtros.limite = Number(tamanoPagina.value);
    filtros.pagina = 1;
    cargarAplicacionesATS();
  });
  btnAnterior?.addEventListener("click", () => {
    if (btnAnterior.disabled) return;
    filtros.pagina = Math.max(1, filtros.pagina - 1);
    cargarAplicacionesATS();
  });
  btnSiguiente?.addEventListener("click", () => {
    if (btnSiguiente.disabled) return;
    filtros.pagina += 1;
    cargarAplicacionesATS();
  });

  btnActualizarAts?.addEventListener("click", () => cargarAplicacionesATS());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelarRefrescoIA();
      if (pendientesIAVisibles) escribirEstadoIA("Actualización automática pausada mientras la pestaña está oculta.", "pausada");
    } else if (pendientesIAVisibles && temporizadorRefrescoIA === null) {
      if (refrescosIA >= MAX_REFRESCOS_IA) programarRefrescoIA();
      else cargarAplicacionesATS({ silenciosa: true });
    }
  });
  window.addEventListener("pagehide", () => {
    paginaCerrandose = true;
    cancelarRefrescoIA();
    controladorCarga?.abort();
  });

  btnLimpiarFiltros?.addEventListener("click", () => {
    clearTimeout(temporizadorBusqueda);
    inputBuscador.value = "";
    filtroEstado.value = "";
    filtros.busqueda = "";
    filtros.estado = "";
    filtros.pagina = 1;
    cargarAplicacionesATS();
    inputBuscador.focus();
  });

  // Modal accesible: cierre con Escape, foco dentro y retorno al control de origen.
  const cerrarModal = (forzar = false) => {
    if (actualizandoEstado && forzar !== true) return;
    modalDetalle.classList.add("hidden");
    aplicacionActualId = null;
    if (anteriorFocoModal?.isConnected) anteriorFocoModal.focus();
    anteriorFocoModal = null;
  };
  modalDetalle?.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") { evento.preventDefault(); cerrarModal(); return; }
    if (evento.key !== "Tab") return;
    const elementos = [...modalDetalle.querySelectorAll('a[href]:not(.hidden), button:not([disabled]):not(.hidden), [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.getClientRects().length > 0);
    if (!elementos.length) { evento.preventDefault(); modalDetalle.focus(); return; }
    const primero = elementos[0], ultimo = elementos[elementos.length - 1];
    if (evento.shiftKey && document.activeElement === primero) { evento.preventDefault(); ultimo.focus(); }
    else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primero.focus(); }
  });
  btnCerrarModal?.addEventListener("click", cerrarModal);

  // Cerrar modal haciendo clic fuera de él (opcional pero muy útil)
  modalDetalle?.addEventListener("click", (e) => {
    if (e.target === modalDetalle) cerrarModal();
  });

  // Cargar al iniciar
  actualizarIndicadoresPagina([]);
  cargarAplicacionesATS();
});
