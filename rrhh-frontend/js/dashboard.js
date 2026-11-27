// ==========================================
// js/dashboard.js
// Controlador de la pantalla Administrativa
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  // 1. Validar Seguridad centralizada con AuthService
  if (!AuthService.estaAutenticado()) {
    window.location.replace("index.html");
    return;
  }

  const usuario = AuthService.obtenerUsuario();
  const token = AuthService.obtenerToken();

  // Utilidad para fetch
  async function fetchJson(url, options = {}) {
    const respuesta = await fetch(url, options);
    const contentType = respuesta.headers.get("content-type") || "";
    const texto = await respuesta.text();

    if (!contentType.includes("application/json")) {
      throw new Error(
        `Respuesta inválida del servidor (${respuesta.status}): ${texto}`,
      );
    }

    try {
      const data = JSON.parse(texto);
      return { respuesta, data };
    } catch (error) {
      throw new Error(`Error parseando JSON: ${error.message} - ${texto}`);
    }
  }

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

  // 2. Referencias al DOM (Panel Central)
  const contadorVacantes = document.getElementById("contador-vacantes");
  const btnLogout = document.getElementById("btn-logout");
  const contenedorEmpleados = document.getElementById("contenedor-empleados");
  const contadorEmpleados = document.getElementById("contador-empleados");
  const contadorAplicaciones = document.getElementById("contador-aplicaciones");
  const formEmpleado = document.getElementById("form-empleado");
  const btnGuardarEmpleado = document.getElementById("btn-guardar-empleado");

  const navLinks = document.querySelectorAll(".nav-link");
  const sectionPanels = document.querySelectorAll(".section-panel");

  // Referencias Usuarios
  const btnCrearUsuario = document.getElementById("btn-crear-usuario");
  const formUsuario = document.getElementById("form-usuario");
  const btnCancelarUsuario = document.getElementById("btn-cancelar-usuario");
  const btnGuardarUsuario = document.getElementById("btn-guardar-usuario");
  const tablaUsuarios = document.getElementById("tabla-usuarios");
  const inputUsuarioNombre = document.getElementById("usuario-nombre");
  const inputUsuarioEmail = document.getElementById("usuario-email");
  const inputUsuarioPassword = document.getElementById("usuario-password");
  const inputUsuarioRol = document.getElementById("usuario-rol");
  let usuarioEditandoId = null;

  // Referencias del Modal de Vacante
  const modalVacante = document.getElementById("modal-vacante");
  const btnNuevaVacante = document.getElementById("btn-nueva-vacante");
  const btnCerrarModal = document.getElementById("btn-cerrar-modal");
  const btnCancelarModal = document.getElementById("btn-cancelar-modal");
  const formVacante = document.getElementById("form-vacante");
  const btnGuardarVacante = document.getElementById("btn-guardar-vacante");
  let vacanteEditandoId = null;

  // Referencias del Modal de Detalle de Vacante
  const modalDetalleVacante = document.getElementById("modal-detalle-vacante");
  const btnCerrarDetalle = document.getElementById(
    "btn-cerrar-detalle-vacante",
  );
  const btnCerrarDetalleFooter = document.getElementById(
    "btn-cerrar-detalle-footer",
  );

  // Variables globales
  let vacantesGlobales = [];
  let departamentosGlobales = [];

  // La API de vacantes devuelve id_departamento, no el objeto relacionado.
  // Resolver el nombre desde el catálogo asegura consistencia en resumen,
  // tabla, filtros y detalle, sin asumir que todas son del área "General".
  function obtenerNombreDepartamento(vacante) {
    const id = vacante?.id_departamento;
    const asociado = id === null || id === undefined || id === ""
      ? null
      : departamentosGlobales.find(
          (d) => Number(d.id_departamento) === Number(id),
        );
    return asociado?.nombre || vacante?.departamentos?.nombre ||
      vacante?.departamento || "Sin departamento";
  }

  // ==========================================
  // UTILIDAD: NOTIFICACIONES UX (TOASTS)
  // ==========================================
  function mostrarNotificacion(mensaje, tipo = "exito") {
    const toast = document.createElement("div");
    const bgColor = tipo === "exito" ? "bg-emerald-600" : "bg-rose-600";
    const icon =
      tipo === "exito" ? "fa-circle-check" : "fa-triangle-exclamation";

    toast.className = `fixed bottom-6 right-6 flex items-center gap-3 px-5 py-3.5 rounded-2xl text-white font-bold text-xs shadow-2xl shadow-${tipo === "exito" ? "emerald" : "rose"}-600/20 transition-all duration-300 transform translate-y-12 opacity-0 z-[9999] ${bgColor}`;
    toast.innerHTML = `<i class="fa-solid ${icon} text-base"></i> <span>${mensaje}</span>`;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.remove("translate-y-12", "opacity-0"), 10);

    setTimeout(() => {
      toast.classList.add("translate-y-12", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ==========================================
  // 3. LOGICA DE DEPARTAMENTOS
  // ==========================================
  async function cargarDepartamentosBD() {
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/departamentos`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (respuesta.ok && data.exito) {
        departamentosGlobales = data.departamentos;

        const selectFiltro = document.getElementById("filtro-dep-vacante");
        const selectModal = document.getElementById("v-departamento");

        if (selectFiltro) {
          selectFiltro.innerHTML = `<option value="">Todos los departamentos</option>`;
          data.departamentos.forEach((d) => {
            selectFiltro.innerHTML += `<option value="${d.nombre}">${d.nombre}</option>`;
          });
        }

        if (selectModal) {
          selectModal.innerHTML = `<option value="">Seleccione un departamento...</option>`;
          data.departamentos.forEach((d) => {
            selectModal.innerHTML += `<option value="${d.id_departamento}">${d.nombre}</option>`;
          });
        }
      } else {
        console.error("No se pudieron cargar los departamentos:", data.error);
      }
    } catch (err) {
      console.error("Error de red al cargar departamentos:", err.message);
    }
  }

  // ==========================================
  // 4. MODALES Y NAVEGACIÓN
  // ==========================================
  const abrirModalCrear = () => {
    vacanteEditandoId = null;
    if (btnGuardarVacante) btnGuardarVacante.textContent = "Publicar Vacante";
    formVacante.reset();

    const hoy = new Date().toISOString().split("T")[0];
    const inputFecha = document.getElementById("v-fecha");
    if (inputFecha) inputFecha.value = hoy;

    modalVacante.classList.remove("hidden");
  };

  const cerrarModal = () => {
    modalVacante.classList.add("hidden");
    formVacante.reset();
    vacanteEditandoId = null;
  };

  btnNuevaVacante?.addEventListener("click", abrirModalCrear);
  btnCerrarModal?.addEventListener("click", cerrarModal);
  btnCancelarModal?.addEventListener("click", cerrarModal);

  const cerrarModalDetalle = () => modalDetalleVacante?.classList.add("hidden");
  btnCerrarDetalle?.addEventListener("click", cerrarModalDetalle);
  btnCerrarDetalleFooter?.addEventListener("click", cerrarModalDetalle);

  // Usamos el método seguro de AuthService para cerrar sesión
  btnLogout?.addEventListener("click", () => AuthService.cerrarSesion());

  const mostrarSeccion = (targetId) => {
    sectionPanels.forEach((section) => {
      section.classList.toggle("hidden", section.id !== targetId);
    });
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.dataset.target === targetId);
    });
  };

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = link.dataset.target;
      mostrarSeccion(targetId);
      history.replaceState(null, "", `#${targetId}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.getElementById("btn-ver-todas-vacantes")?.addEventListener("click", () => {
    mostrarSeccion("seccion-vacantes");
    history.replaceState(null, "", "#seccion-vacantes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ==========================================
  // CONTROL DE SECCIÓN INICIAL (VÍA HASH DE URL)
  // ==========================================
  const hashUrl = window.location.hash.replace("#", "");
  if (hashUrl && document.getElementById(hashUrl)) {
    mostrarSeccion(hashUrl);
  } else {
    mostrarSeccion("seccion-resumen");
  }

  // ==========================================
  // 5. GESTIÓN DE USUARIOS
  // ==========================================
  async function cargarUsuarios() {
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/usuarios`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!respuesta.ok || !data.exito)
        throw new Error(data.error || "Error al cargar usuarios");

      if (tablaUsuarios) tablaUsuarios.innerHTML = "";

      if (data.usuarios.length === 0 && tablaUsuarios) {
        tablaUsuarios.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-sm text-slate-500">No hay usuarios registrados.</td></tr>`;
        return;
      }

      data.usuarios.forEach((usuarioItem) => {
        const row = document.createElement("tr");
        row.className = "text-slate-700 border-b border-slate-100";
        row.innerHTML = `
                    <td class="py-3 pr-4 font-semibold">${SecurityUtils.escapeHTML(usuarioItem.nombre)}</td>
                    <td class="py-3 pr-4">${SecurityUtils.escapeHTML(usuarioItem.email)}</td>
                    <td class="py-3 pr-4"><span class="px-3 py-1 rounded-full border text-[11px] font-black uppercase tracking-wider ${usuarioItem.rol === "admin" ? "bg-orange-50 border-orange-200 text-orange-600" : "bg-slate-50 border-slate-200 text-slate-600"}">${SecurityUtils.escapeHTML(usuarioItem.rol)}</span></td>
                    <td class="py-3 pr-4">${new Date(usuarioItem.created_at).toLocaleDateString("es-ES")}</td>
                    <td class="py-3 pr-4 text-right">
                        <div class="flex justify-end gap-2">
                            <button data-action="editar" data-user-id="${usuarioItem.id}" class="px-3 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-700 text-xs font-bold">Editar</button>
                            <button data-action="eliminar" data-user-id="${usuarioItem.id}" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">Eliminar</button>
                        </div>
                    </td>
                `;
        if (tablaUsuarios) tablaUsuarios.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  }

  btnCrearUsuario?.addEventListener("click", () => {
    usuarioEditandoId = null;
    formUsuario.classList.remove("hidden");
    btnGuardarUsuario.textContent = "Guardar usuario";
    formUsuario.reset();
    inputUsuarioPassword.required = true;
    inputUsuarioNombre.focus();
  });

  btnCancelarUsuario?.addEventListener("click", () => {
    formUsuario.classList.add("hidden");
    formUsuario.reset();
    usuarioEditandoId = null;
  });

  formUsuario?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      nombre: inputUsuarioNombre.value.trim(),
      email: inputUsuarioEmail.value.trim(),
      password: inputUsuarioPassword.value,
      rol: inputUsuarioRol.value,
    };

    const method = usuarioEditandoId ? "PUT" : "POST";
    const url = usuarioEditandoId
      ? `${CONFIG.API_URL}/admin/usuarios/${usuarioEditandoId}`
      : `${CONFIG.API_URL}/admin/usuarios`;

    try {
      const { respuesta, data } = await fetchJson(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!respuesta.ok || !data.exito) {
        NotificationService.apiError(respuesta, data, "No fue posible guardar el usuario.");
        return;
      }

      formUsuario.classList.add("hidden");
      formUsuario.reset();
      usuarioEditandoId = null;
      await cargarUsuarios();
      NotificationService.success("Usuario guardado", data.mensaje || "El usuario fue guardado correctamente.");
    } catch (err) {
      console.error("Error guardando usuario desde dashboard:", err);
      NotificationService.error("No pudimos guardar el usuario", "Intenta nuevamente en unos segundos.");
    }
  });

  // ==========================================
  // 6. GESTIÓN DE EMPLEADOS
  // ==========================================
  async function cargarEmpleados() {
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/empleados`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!respuesta.ok || !data.exito) throw new Error(data.error);

      // El KPI global se obtiene exclusivamente de /admin/stats (conteo exacto).
      if (contenedorEmpleados) contenedorEmpleados.innerHTML = "";

      if (data.empleados.length === 0 && contenedorEmpleados) {
        contenedorEmpleados.innerHTML = `<div class="col-span-full rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Aún no hay empleados registrados.</div>`;
        return;
      }

      data.empleados.forEach((empleado) => {
        const card = document.createElement("div");
        card.className =
          "rounded-2xl border border-slate-200 p-4 bg-white shadow-sm";
        card.innerHTML = `
                    <div class="flex items-center justify-between mb-3">
                        <h5 class="font-bold text-slate-800">${SecurityUtils.escapeHTML(empleado.nombre)}</h5>
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${empleado.estado === "Activo" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 border border-slate-200"}">${SecurityUtils.escapeHTML(empleado.estado)}</span>
                    </div>
                    <p class="text-sm text-slate-500">${SecurityUtils.escapeHTML(empleado.correo)}</p>
                    <p class="text-[11px] text-slate-400 mt-3">Contratación: ${new Date(empleado.fecha_contratacion).toLocaleDateString("es-ES")}</p>
                `;
        if (contenedorEmpleados) contenedorEmpleados.appendChild(card);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ==========================================
  // ==========================================
  // GESTIÓN DE ESTADÍSTICAS DEL DASHBOARD
  // ==========================================
  async function cargarStatsDashboard() {
    const botonActualizar = document.getElementById("btn-actualizar-metricas");
    if (botonActualizar) { botonActualizar.disabled = true; botonActualizar.setAttribute('aria-busy', 'true'); }
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/stats`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (respuesta.ok && data.exito && data.stats) {
        if (contadorVacantes) contadorVacantes.innerText = data.stats.total_vacantes;
        if (contadorAplicaciones) contadorAplicaciones.innerText = data.stats.total_aplicaciones;
        if (contadorEmpleados) contadorEmpleados.innerText = data.stats.total_empleados;
        const unicos = document.getElementById("stats-candidatos-unicos");
        const pendientes = document.getElementById("stats-pendientes-ia");
        const promedio = document.getElementById("stats-promedio-ia");
        const etapas = document.getElementById("stats-etapas-ats");
        if (unicos) unicos.textContent = Number(data.stats.total_candidatos_unicos || 0).toLocaleString("es-HN");
        if (pendientes) pendientes.textContent = Number(data.stats.pendientes_ia || 0).toLocaleString("es-HN");
        if (promedio) promedio.textContent = Number(data.stats.evaluadas_ia || 0) > 0
          ? `${data.stats.score_promedio_ia}%` : "Sin evaluaciones";
        if (etapas) {
          const conteos = new Map((data.stats.por_estado || []).map(e => [e.estado, Number(e.cantidad) || 0]));
          const total = Number(data.stats.total_aplicaciones) || 0;
          const estados = [
            ['Recibida', 'fa-inbox'], ['En Revisión', 'fa-magnifying-glass'],
            ['Entrevista', 'fa-user-group'], ['Contratado', 'fa-circle-check'],
            ['Descartado', 'fa-user-xmark'],
          ];
          etapas.replaceChildren();
          for (const [estado, icono] of estados) {
            const valor = conteos.get(estado) ?? 0;
            const porcentaje = total > 0 ? Math.max(0, Math.min(100, valor / total * 100)) : 0;
            const bloque = document.createElement('div');
            bloque.className = 'dash-stage-row';
            const cabecera = document.createElement('div');
            cabecera.className = 'dash-stage-heading';
            const etiqueta = document.createElement('span');
            etiqueta.className = 'dash-stage-label';
            const i = document.createElement('i');
            i.className = `fa-solid ${icono}`;
            i.setAttribute('aria-hidden', 'true');
            etiqueta.append(i, document.createTextNode(estado));
            const cantidad = document.createElement('strong');
            cantidad.textContent = `${valor} · ${Math.round(porcentaje)}%`;
            cabecera.append(etiqueta, cantidad);
            const pista = document.createElement('div');
            pista.className = 'dash-stage-track';
            pista.setAttribute('role', 'progressbar');
            pista.setAttribute('aria-label', `${estado}: ${valor} de ${total} postulaciones`);
            pista.setAttribute('aria-valuemin', '0');
            pista.setAttribute('aria-valuemax', '100');
            pista.setAttribute('aria-valuenow', String(Math.round(porcentaje)));
            const relleno = document.createElement('span');
            relleno.className = estado === 'Descartado' ? 'dash-stage-fill dash-stage-muted' : 'dash-stage-fill';
            relleno.style.width = `${porcentaje}%`;
            pista.append(relleno);
            bloque.append(cabecera, pista);
            etapas.append(bloque);
          }
        }
      }
    } catch (err) {
      console.error("Error al cargar estadísticas:", err.message);
      const etapas = document.getElementById("stats-etapas-ats");
      if (etapas) etapas.textContent = "No fue posible actualizar los indicadores. Inténtalo de nuevo.";
    } finally {
      if (botonActualizar) { botonActualizar.disabled = false; botonActualizar.removeAttribute('aria-busy'); }
    }
  }
  document.getElementById("btn-actualizar-metricas")?.addEventListener("click", cargarStatsDashboard);

  // ==========================================
  // 7. GESTIÓN DE VACANTES
  // ==========================================
  async function cargarVacantes() {
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/vacantes`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!respuesta.ok || !data.exito) throw new Error(data.error);

      vacantesGlobales = data.vacantes;
      // El KPI global se obtiene exclusivamente de /admin/stats (conteo exacto).

      renderizarTablaVacantes(vacantesGlobales);
      renderizarResumenVacantesCards(vacantesGlobales);
    } catch (err) {
      console.error(err);
    }
  }

  function renderizarTablaVacantes(vacantes) {
    const tbody = document.getElementById("tabla-vacantes-body");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (vacantes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No se encontraron vacantes.</td></tr>`;
      return;
    }

    vacantes.forEach((v) => {
      const idVacante = v.id_vacante || v.id;

      const nombreDepto = obtenerNombreDepartamento(v);

      const fechaFormateada = v.fecha_creacion
        ? v.fecha_creacion
        : v.created_at
          ? v.created_at.split("T")[0]
          : "N/A";
      const estadoClase =
        v.estado === "Activa" || v.estado === "Abierta"
          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
          : "bg-slate-50 text-slate-600 border-slate-200";

      const tr = document.createElement("tr");
      tr.className =
        "hover:bg-slate-50/80 transition-colors border-b border-slate-100";
      tr.innerHTML = `
                <td class="py-4 px-6 font-bold text-blue-950">${SecurityUtils.escapeHTML(v.titulo)}</td>
                <td class="py-4 px-6 text-slate-600 font-medium">${SecurityUtils.escapeHTML(nombreDepto)}</td>
                <td class="py-4 px-6"><span class="px-2.5 py-1 rounded-full font-bold text-[10px] border ${estadoClase}">${SecurityUtils.escapeHTML(v.estado || "Activa")}</span></td>
                <td class="py-4 px-6 text-slate-500 font-medium">${SecurityUtils.escapeHTML(fechaFormateada)}</td>
                <td class="py-4 px-6 text-right">
                    <div class="flex justify-end gap-2">
                        <button onclick="verDetalleVacante(${idVacante})" class="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition-all text-[11px]">Ver</button>
                        <button onclick="prepararActualizarVacante(${idVacante})" class="px-2.5 py-1.5 bg-slate-100 hover:bg-blue-200 text-slate-700 font-bold rounded-xl transition-all text-[11px]">Editar</button>
                        <button onclick="eliminarVacante(${idVacante})" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl transition-all text-[11px]">Eliminar</button>
                    </div>
                </td>
            `;
      tbody.appendChild(tr);
    });
  }

  function renderizarResumenVacantesCards(vacantes) {
    const resumenContainer = document.getElementById("resumen-vacantes-cards");
    if (!resumenContainer) return;

    const recientes = [...vacantes]
      .sort((a, b) => Number(b.id_vacante ?? b.id) - Number(a.id_vacante ?? a.id))
      .slice(0, 3);
    const resumenTotal = document.getElementById("resumen-vacantes-total");
    if (resumenTotal) {
      resumenTotal.textContent = `Mostrando ${recientes.length} de ${vacantes.length} vacantes`;
    }

    resumenContainer.replaceChildren();
    if (recientes.length === 0) {
      resumenContainer.innerHTML = `<p class="text-xs text-slate-400">No hay vacantes registradas.</p>`;
      return;
    }

    recientes.forEach((v) => {
      const card = document.createElement("div");
      card.className =
        "p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3";
      const estado = v.estado || "Sin estado";
      const activa = estado === "Activa" || estado === "Abierta";
      const claseEstado = activa
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-100 text-slate-600 border-slate-200";
      card.innerHTML = `
        <div class="min-w-0">
          <h6 class="text-xs font-bold text-blue-950">${SecurityUtils.escapeHTML(v.titulo)}</h6>
          <p class="text-[10px] text-slate-500 font-medium mt-1">${SecurityUtils.escapeHTML(obtenerNombreDepartamento(v))}</p>
        </div>
        <span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border ${claseEstado}">${SecurityUtils.escapeHTML(estado)}</span>
      `;
      resumenContainer.appendChild(card);
    });
  }

  // Filtrado de Vacantes
  document
    .getElementById("filtro-buscar-vacante")
    ?.addEventListener("input", filtrarVacantes);
  document
    .getElementById("filtro-dep-vacante")
    ?.addEventListener("change", filtrarVacantes);
  document
    .getElementById("filtro-fecha-vacante")
    ?.addEventListener("change", filtrarVacantes);

  function filtrarVacantes() {
    const texto =
      document.getElementById("filtro-buscar-vacante")?.value.toLowerCase() ||
      "";
    const deptoSeleccionado =
      document.getElementById("filtro-dep-vacante")?.value || "";
    const fechaSeleccionada =
      document.getElementById("filtro-fecha-vacante")?.value || "";

    const filtradas = vacantesGlobales.filter((v) => {
      const deptoNombre = obtenerNombreDepartamento(v);
      const fechaVacante =
        v.fecha_creacion || (v.created_at ? v.created_at.split("T")[0] : "");

      const coincideTexto =
        v.titulo.toLowerCase().includes(texto) ||
        (v.descripcion_puesto &&
          v.descripcion_puesto.toLowerCase().includes(texto));
      const coincideDepto =
        !deptoSeleccionado || deptoNombre === deptoSeleccionado;
      const coincideFecha =
        !fechaSeleccionada || fechaVacante === fechaSeleccionada;

      return coincideTexto && coincideDepto && coincideFecha;
    });

    renderizarTablaVacantes(filtradas);
  }

  // Acciones de Vacantes (Ver, Actualizar, Eliminar)
  window.verDetalleVacante = function (id) {
    const vacante = vacantesGlobales.find(
      (v) => Number(v.id_vacante || v.id) === Number(id),
    );
    if (!vacante) return;

    const nombreDepto = obtenerNombreDepartamento(vacante);

    document.getElementById("detalle-vacante-titulo").textContent =
      vacante.titulo;
    document.getElementById("detalle-vacante-depto").textContent = nombreDepto;
    document.getElementById("detalle-vacante-desc").textContent =
      vacante.descripcion_puesto || "Sin descripción";
    document.getElementById("detalle-vacante-req").textContent =
      vacante.requisitos || "Sin requisitos específicos";
    document.getElementById("detalle-vacante-estado").textContent =
      vacante.estado || "Activa";

    document.getElementById("detalle-vacante-fecha").textContent =
      vacante.fecha_creacion
        ? vacante.fecha_creacion
        : vacante.created_at
          ? vacante.created_at.split("T")[0]
          : "N/A";

    modalDetalleVacante?.classList.remove("hidden");
  };

  window.prepararActualizarVacante = function (id) {
    const vacante = vacantesGlobales.find(
      (v) => Number(v.id_vacante || v.id) === Number(id),
    );
    if (!vacante) return;

    vacanteEditandoId = id;
    document.getElementById("v-titulo").value = vacante.titulo || "";
    document.getElementById("v-departamento").value =
      vacante.id_departamento || "";
    document.getElementById("v-fecha").value =
      vacante.fecha_creacion ||
      (vacante.created_at ? vacante.created_at.split("T")[0] : "");
    document.getElementById("v-descripcion").value =
      vacante.descripcion_puesto || "";
    document.getElementById("v-requisitos").value = vacante.requisitos || "";

    if (btnGuardarVacante) btnGuardarVacante.textContent = "Actualizar Vacante";
    modalVacante.classList.remove("hidden");
  };

  window.eliminarVacante = async function (id) {
    if (!await DialogService.confirm('Esta vacante se eliminará del catálogo. Verifica que no tenga postulaciones asociadas.', { title: 'Eliminar vacante', variant: 'danger', confirmText: 'Eliminar vacante' })) return;
    try {
      const { respuesta, data } = await fetchJson(
        `${CONFIG.API_URL}/admin/vacantes/${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!respuesta.ok || !data.exito) throw new Error(data.error);

      mostrarNotificacion("Vacante eliminada de la base de datos.", "exito");
      await cargarVacantes();
    } catch (err) {
      mostrarNotificacion(`Error: ${err.message}`, "error");
    }
  };

  formVacante?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      titulo: document.getElementById("v-titulo").value.trim(),
      id_departamento: document.getElementById("v-departamento").value.trim(),
      fecha_creacion: document.getElementById("v-fecha").value,
      descripcion_puesto: document.getElementById("v-descripcion").value.trim(),
      requisitos: document.getElementById("v-requisitos").value.trim(),
    };

    const method = vacanteEditandoId ? "PUT" : "POST";
    const url = vacanteEditandoId
      ? `${CONFIG.API_URL}/admin/vacantes/${vacanteEditandoId}`
      : `${CONFIG.API_URL}/admin/vacantes`;

    const originalBtnText = btnGuardarVacante.innerHTML;
    btnGuardarVacante.innerHTML =
      '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';
    btnGuardarVacante.disabled = true;

    try {
      const { respuesta, data } = await fetchJson(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!respuesta.ok || !data.exito) {
        throw new Error(data.error || "No se pudo procesar la solicitud");
      }

      cerrarModal();
      await cargarVacantes();

      mostrarNotificacion(
        data.mensaje || "Vacante guardada con éxito.",
        "exito",
      );
    } catch (err) {
      mostrarNotificacion(`Error al guardar: ${err.message}`, "error");
    } finally {
      btnGuardarVacante.innerHTML = originalBtnText;
      btnGuardarVacante.disabled = false;
    }
  });

  // ==========================================
  // GESTIÓN DE BASE DE CONOCIMIENTO (RAG)
  // ==========================================
  const tablaDocumentosBody = document.getElementById("tabla-documentos-body");
  const modalDocumento = document.getElementById("modal-documento");
  const formDocumento = document.getElementById("form-documento");
  const btnNuevoDocumento = document.getElementById("btn-nuevo-documento");
  const btnCerrarModalDoc = document.getElementById("btn-cerrar-modal-doc");
  const btnGuardarDoc = document.getElementById("btn-guardar-doc");

  // 1. Cargar documentos existentes
  async function cargarDocumentosRAG() {
      if (!tablaDocumentosBody) return;
      
      try {
          const { respuesta, data } = await fetchJson(`${CONFIG.API_URL}/admin/documentos`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` }
          });

          if (!respuesta.ok || !data.exito) throw new Error(data.error);

          tablaDocumentosBody.innerHTML = "";
          
          if (data.documentos.length === 0) {
              tablaDocumentosBody.innerHTML = `<tr><td colspan="2" class="py-6 text-center text-slate-400">No hay documentos en la base de conocimiento.</td></tr>`;
              return;
          }

          data.documentos.forEach(doc => {
              const tr = document.createElement("tr");
              tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100";
              tr.innerHTML = `
                  <td class="py-4 px-6 font-bold text-blue-950">
                      <i class="fa-solid fa-file-pdf text-rose-500 mr-2"></i> ${SecurityUtils.escapeHTML(doc.titulo)}
                  </td>
                  <td class="py-4 px-6 text-center text-slate-500 font-medium">
                      ${new Date(doc.fecha_actualizacion).toLocaleDateString("es-ES")}
                  </td>
              `;
              tablaDocumentosBody.appendChild(tr);
          });
      } catch (err) {
          console.error("Error al cargar documentos:", err);
          tablaDocumentosBody.innerHTML = `<tr><td colspan="2" class="py-6 text-center text-rose-500">Error al cargar la base de conocimiento.</td></tr>`;
      }
  }

  // 2. Lógica del Modal
  btnNuevoDocumento?.addEventListener("click", () => {
      formDocumento.reset();
      modalDocumento.classList.remove("hidden");
  });

  btnCerrarModalDoc?.addEventListener("click", () => {
      modalDocumento.classList.add("hidden");
  });

  // 3. Enviar PDF al backend
  formDocumento?.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const titulo = document.getElementById("doc-titulo").value;
      const archivoInput = document.getElementById("doc-archivo");
      
      if (archivoInput.files.length === 0) {
          mostrarNotificacion("Debes seleccionar un PDF.", "error");
          return;
      }

      const formData = new FormData();
      formData.append("titulo", titulo);
      formData.append("archivo_documento", archivoInput.files[0]);

      const originalText = btnGuardarDoc.innerHTML;
      btnGuardarDoc.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Extrayendo texto...';
      btnGuardarDoc.disabled = true;

      try {
          const respuesta = await fetch(`${CONFIG.API_URL}/admin/documentos`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` }, // OJO: NO poner Content-Type con FormData
              body: formData
          });
          
          const data = await respuesta.json();
          if (!respuesta.ok || !data.exito) throw new Error(data.error);

          mostrarNotificacion("Documento procesado e IA actualizada.", "exito");
          modalDocumento.classList.add("hidden");
          await cargarDocumentosRAG(); // Recargar la tabla
      } catch (err) {
          mostrarNotificacion(`Error: ${err.message}`, "error");
      } finally {
          btnGuardarDoc.innerHTML = originalText;
          btnGuardarDoc.disabled = false;
      }
  });

  // ==========================================
  // INICIALIZACIÓN
  // ==========================================
  // Evita renderizar departamentos como desconocidos por una condición de carrera.
  // Si el catálogo falla, cargarDepartamentosBD maneja el error y permite listar vacantes.
  async function inicializarCatalogosVacantes() {
    await cargarDepartamentosBD();
    await cargarVacantes();
  }

  void inicializarCatalogosVacantes();
  cargarStatsDashboard();
  cargarUsuarios();
  cargarEmpleados();
  cargarDocumentosRAG(); // Cargar documentos al inicio
});
