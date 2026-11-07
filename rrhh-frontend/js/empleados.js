// ==========================================
// js/empleados.js
// Controlador de Empleados
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  if (!AuthService.estaAutenticado()) {
    window.location.replace("index.html");
    return;
  }

  const token = AuthService.obtenerToken();
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

  document.getElementById("btn-logout")?.addEventListener("click", () => AuthService.cerrarSesion());

  const tablaBody = document.getElementById("tabla-empleados-body");
  const modalEmpleado = document.getElementById("modal-empleado");
  const formEmpleado = document.getElementById("form-empleado");
  const btnNuevoEmpleado = document.getElementById("btn-nuevo-empleado");
  const btnCerrarModal = document.getElementById("btn-cerrar-modal-empleado");
  const btnCancelar = document.getElementById("btn-cancelar-empleado");
  const modalTitulo = document.getElementById("modal-empleado-titulo");

  let empleadosGlobales = [];
  let departamentosGlobales = [];
  let cargosGlobales = [];
  let usuariosGlobales = [];
  let cuentasCargadas = false;
  let empleadoEditandoId = null;

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    try { return { res, data: JSON.parse(text) }; } catch(e) { throw new Error(text); }
  }

  async function cargarDepartamentos() {
    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/admin/departamentos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.exito) {
        departamentosGlobales = data.departamentos;
        const selectModal = document.getElementById("emp-departamento");
        const selectFiltro = document.getElementById("filtro-depto-empleado");
        
        const html = '<option value="">Sin departamento / Todas las áreas</option>' + 
          departamentosGlobales.map(d => `<option value="${d.id_departamento}">${SecurityUtils.escapeHTML(d.nombre)}</option>`).join('');
        
        if (selectModal) selectModal.innerHTML = html;
        if (selectFiltro) selectFiltro.innerHTML = html;
      }
    } catch (e) { console.error("Error al cargar departamentos", e); }
  }

  async function cargarCargos() {
    try {
      const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/cargos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok || !data.exito) throw new Error(data.error || "No fue posible cargar cargos.");
      cargosGlobales = data.cargos;
      const selectModal = document.getElementById("emp-cargo");
      const selectFiltro = document.getElementById("filtro-cargo-empleado");
      if (selectModal) {
        selectModal.innerHTML = '<option value="">Sin cargo asignado</option>' +
          cargosGlobales.map(c => `<option value="${c.id_cargo}">${SecurityUtils.escapeHTML(c.nombre)}</option>`).join("");
      }
      if (selectFiltro) {
        selectFiltro.innerHTML = '<option value="">Todos los cargos</option>' +
          cargosGlobales.map(c => `<option value="${c.id_cargo}">${SecurityUtils.escapeHTML(c.nombre)}</option>`).join("");
      }
    } catch (error) {
      console.error("Error al cargar cargos:", error);
      NotificationService.error("No se pudieron cargar los cargos", "Verifica la conexión e intenta nuevamente.");
    }
  }

  async function cargarCuentas() {
    try {
      const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/usuarios`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok || !data.exito) throw new Error(data.error || "Error al cargar usuarios.");
      usuariosGlobales = data.usuarios;
      cuentasCargadas = true;
    } catch (error) {
      console.error("No fue posible obtener las cuentas:", error);
      cuentasCargadas = false;
      NotificationService.warning("Cuentas no disponibles", "Puedes gestionar empleados, pero la vinculación de cuentas estará desactivada.");
    }
  }

  function poblarCuentas(empleadoId = null) {
    const select = document.getElementById("emp-usuario");
    if (!select) return;
    select.disabled = !cuentasCargadas;
    const actual = empleadosGlobales.find(e => String(e.id_empleado) === String(empleadoId));
    const cuentasEnUso = new Set(
      empleadosGlobales.filter(e => e.id_usuario && String(e.id_empleado) !== String(empleadoId))
        .map(e => String(e.id_usuario))
    );
    select.innerHTML = '<option value="">Sin cuenta vinculada</option>' + usuariosGlobales
      .filter(u => !cuentasEnUso.has(String(u.id)))
      .map(u => `<option value="${SecurityUtils.escapeHTML(u.id)}">${SecurityUtils.escapeHTML(u.nombre)} — ${SecurityUtils.escapeHTML(u.email)} (${SecurityUtils.escapeHTML(u.rol)})</option>`)
      .join("");
    select.value = actual?.id_usuario || "";
  }

  async function cargarEmpleados() {
    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/admin/empleados`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.exito) {
        empleadosGlobales = data.empleados;
        aplicarFiltros();
        actualizarStats();
      }
    } catch (e) {
      tablaBody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-rose-500">Error al cargar empleados</td></tr>`;
    }
  }

  function actualizarStats() {
    document.getElementById("stat-total").innerText = empleadosGlobales.length;
    document.getElementById("stat-activos").innerText = empleadosGlobales.filter(e => e.estado === "Activo").length;
    document.getElementById("stat-inactivos").innerText = empleadosGlobales.filter(e => e.estado === "Inactivo").length;
    document.getElementById("stat-deptos").innerText = departamentosGlobales.length;
  }

  function renderizarTabla(lista) {
    tablaBody.innerHTML = "";
    if (lista.length === 0) {
      tablaBody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-slate-500">
        <div class="flex flex-col items-center justify-center">
          <i class="fa-solid fa-users-slash text-4xl text-slate-300 mb-3"></i>
          <p>No se encontraron empleados que coincidan con los filtros.</p>
        </div>
      </td></tr>`;
      return;
    }
    lista.forEach(emp => {
      const depto = emp.departamentos?.nombre || "N/A";
      const puesto = emp.cargos?.nombre || "Sin cargo";
      const cuenta = emp.cuenta ? emp.cuenta.email : "Sin cuenta";
      
      const esActivo = emp.estado === "Activo";
      const estadoClase = esActivo 
        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
        : "bg-slate-50 text-slate-500 border-slate-200";
      
      const fecha = emp.fecha_contratacion ? new Date(emp.fecha_contratacion).toLocaleDateString("es-ES") : "N/A";
      
      // Initials for avatar
      const iniciales = emp.nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      const avatarColor = esActivo ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500";
      
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-100 hover:bg-blue-50/30 transition-colors group";
      tr.innerHTML = `
        <td class="py-3 px-6">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full ${avatarColor} flex items-center justify-center font-bold text-xs shrink-0">
              ${SecurityUtils.escapeHTML(iniciales)}
            </div>
            <div>
              <p class="font-bold text-blue-950">${SecurityUtils.escapeHTML(emp.nombre)}</p>
            </div>
          </div>
        </td>
        <td class="py-3 px-6 text-slate-600 font-medium">${SecurityUtils.escapeHTML(emp.correo)}</td>
        <td class="py-3 px-6">
          <span class="px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-[11px]">${SecurityUtils.escapeHTML(depto)}</span>
        </td>
        <td class="py-3 px-6 text-slate-600 font-medium">${SecurityUtils.escapeHTML(puesto)}</td>
        <td class="py-3 px-6 text-slate-500 text-xs">${SecurityUtils.escapeHTML(fecha)}</td>
        <td class="py-3 px-6 text-slate-500 text-xs">${SecurityUtils.escapeHTML(cuenta)}</td>
        <td class="py-3 px-6">
          <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${estadoClase}">
            <i class="fa-solid fa-circle text-[8px] mr-1 ${esActivo ? 'text-emerald-500' : 'text-slate-400'}"></i>
            ${SecurityUtils.escapeHTML(emp.estado)}
          </span>
        </td>
        <td class="py-3 px-6 text-right">
          <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button data-action="toggle-estado" data-id="${emp.id_empleado}" class="w-8 h-8 rounded-lg ${esActivo ? 'bg-orange-50 text-orange-600 hover:bg-orange-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'} flex items-center justify-center transition-all" title="${esActivo ? 'Inactivar' : 'Activar'}">
              <i class="fa-solid ${esActivo ? 'fa-user-slash' : 'fa-user-check'}"></i>
            </button>
            <button data-action="editar" data-id="${emp.id_empleado}" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-all" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button data-action="eliminar" data-id="${emp.id_empleado}" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-all" title="Eliminar definitivamente">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      `;
      tablaBody.appendChild(tr);
    });
  }

  const cerrarModal = () => {
    modalEmpleado.classList.add("hidden");
    formEmpleado.reset();
    empleadoEditandoId = null;
  };

  btnNuevoEmpleado?.addEventListener("click", () => {
    empleadoEditandoId = null;
    modalTitulo.innerText = "Nuevo Empleado";
    formEmpleado.reset();
    document.getElementById("emp-fecha").value = new Date().toISOString().split("T")[0];
    document.getElementById("emp-estado").value = "Activo";
    poblarCuentas();
    modalEmpleado.classList.remove("hidden");
  });

  btnCerrarModal?.addEventListener("click", cerrarModal);
  btnCancelar?.addEventListener("click", cerrarModal);

  formEmpleado?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      nombre: document.getElementById("emp-nombre").value,
      correo: document.getElementById("emp-correo").value,
      fecha_contratacion: document.getElementById("emp-fecha").value,
      estado: document.getElementById("emp-estado").value,
      id_departamento: document.getElementById("emp-departamento").value || null,
      id_cargo: document.getElementById("emp-cargo").value || null
    };

    const cuentaSelect = document.getElementById("emp-usuario");
    // Si falló la carga de usuarios, NO desvincular accidentalmente una cuenta.
    if (!cuentaSelect.disabled) payload.id_usuario = cuentaSelect.value || null;

    const method = empleadoEditandoId ? "PUT" : "POST";
    const url = empleadoEditandoId 
      ? `${CONFIG.API_URL}/admin/empleados/${empleadoEditandoId}`
      : `${CONFIG.API_URL}/admin/empleados`;

    try {
      const { res, data } = await fetchJson(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok && data.exito) {
        const eraEdicion = Boolean(empleadoEditandoId);
        cerrarModal();
        await cargarEmpleados();
        NotificationService.success(
          eraEdicion ? "Empleado actualizado" : "Empleado registrado",
          eraEdicion ? "Los cambios fueron guardados correctamente." : "El empleado fue agregado correctamente.",
        );
      } else {
        NotificationService.apiError(res, data, "No fue posible guardar el empleado.");
      }
    } catch (err) {
      console.error("Error guardando empleado:", err);
      NotificationService.error("No pudimos guardar el empleado", "Verifica la información e intenta nuevamente.");
    }
  });

  tablaBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const emp = empleadosGlobales.find(x => String(x.id_empleado) === String(id));
    if (!emp) return;

    if (action === "editar") {
      empleadoEditandoId = id;
      modalTitulo.innerText = "Editar Empleado";
      document.getElementById("emp-nombre").value = emp.nombre;
      document.getElementById("emp-correo").value = emp.correo;
      document.getElementById("emp-fecha").value = emp.fecha_contratacion.split("T")[0];
      document.getElementById("emp-estado").value = emp.estado || "Activo";
      
      const deptoId = departamentosGlobales.find(d => d.nombre === emp.departamentos?.nombre)?.id_departamento;
      document.getElementById("emp-departamento").value = deptoId || "";
      
      document.getElementById("emp-cargo").value = emp.id_cargo || "";
      poblarCuentas(id);
      modalEmpleado.classList.remove("hidden");
    } else if (action === "toggle-estado") {
      const nuevoEstado = emp.estado === "Activo" ? "Inactivo" : "Activo";
      if (await DialogService.confirm(`¿Marcar a ${emp.nombre} como ${nuevoEstado}?`, { title: 'Cambiar estado de empleado', variant: 'warning', confirmText: 'Guardar cambio' })) {
        try {
          const payload = { estado: nuevoEstado };
          const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/empleados/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            await cargarEmpleados();
            NotificationService.success("Estado actualizado", `${emp.nombre} ahora está ${nuevoEstado.toLowerCase()}.`);
          } else {
            NotificationService.apiError(res, data, "No fue posible cambiar el estado.");
          }
        } catch (err) {
          console.error("Error al cambiar estado de empleado:", err);
          NotificationService.error("No pudimos cambiar el estado", "Intenta nuevamente en unos segundos.");
        }
      }
    } else if (action === "eliminar") {
      if (await DialogService.confirm(`¿Eliminar a ${emp.nombre}? Esta acción no se puede deshacer.`, { title: 'Eliminar empleado', variant: 'danger', confirmText: 'Eliminar empleado' })) {
        try {
          const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/empleados/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            await cargarEmpleados();
            NotificationService.success("Empleado eliminado", "El registro fue eliminado correctamente.");
          } else {
            NotificationService.apiError(res, data, "No fue posible eliminar el empleado.");
          }
        } catch (err) {
          console.error("Error al eliminar empleado:", err);
          NotificationService.error("No pudimos eliminar el empleado", "Intenta nuevamente en unos segundos.");
        }
      }
    }
  });

  // Filtros
  const filtros = ["buscador-empleados", "filtro-depto-empleado", "filtro-cargo-empleado", "filtro-estado-empleado"];
  filtros.forEach(id => {
    document.getElementById(id)?.addEventListener("input", aplicarFiltros);
    document.getElementById(id)?.addEventListener("change", aplicarFiltros);
  });

  function aplicarFiltros() {
    const term = (document.getElementById("buscador-empleados")?.value || "").toLowerCase();
    const deptoId = document.getElementById("filtro-depto-empleado")?.value;
    const cargoId = document.getElementById("filtro-cargo-empleado")?.value;
    const estado = document.getElementById("filtro-estado-empleado")?.value;

    // We need to resolve names for filtering if we filter by IDs
    const deptoNombre = deptoId ? departamentosGlobales.find(d => String(d.id_departamento) === String(deptoId))?.nombre : null;
    const cargoNombre = cargoId ? cargosGlobales.find(c => String(c.id_cargo) === String(cargoId))?.nombre : null;

    let filtrados = empleadosGlobales.filter(emp => {
      const matchTerm = emp.nombre.toLowerCase().includes(term) || 
                        emp.correo.toLowerCase().includes(term);
      const matchDepto = deptoNombre ? (emp.departamentos?.nombre === deptoNombre) : true;
      const matchCargo = cargoNombre ? (emp.cargos?.nombre === cargoNombre) : true;
      const matchEstado = estado ? emp.estado === estado : true;
      
      return matchTerm && matchDepto && matchCargo && matchEstado;
    });
    renderizarTabla(filtrados);
  }


  // Un fallo al cargar usuarios nunca debe impedir ver el listado de empleados.
  Promise.all([cargarDepartamentos(), cargarCargos(), cargarCuentas()]).then(cargarEmpleados);
});
