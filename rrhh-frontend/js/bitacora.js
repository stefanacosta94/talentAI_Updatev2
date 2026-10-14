// ==========================================
// js/bitacora.js
// Controlador de Bitácora de Auditoría
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

  const tablaBody = document.getElementById("tabla-bitacora-body");
  const selectLimite = document.getElementById("filtro-limite");
  const btnRefrescar = document.getElementById("btn-refrescar");
  const buscador = document.getElementById("buscador-bitacora");
  const filtroModulo = document.getElementById("filtro-modulo");

  let registrosGlobales = [];

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    try { return { res, data: JSON.parse(text) }; } catch(e) { throw new Error(text); }
  }

  async function cargarBitacora() {
    const limite = selectLimite.value;
    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/admin/bitacora?limite=${limite}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.exito) {
        registrosGlobales = data.registros;
        filtrarYRenderizar();
      }
    } catch (e) {
      tablaBody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-rose-500">Error al cargar bitácora</td></tr>`;
    }
  }

  function actualizarStats(registros) {
    document.getElementById("stat-total-logs").innerText = registros.length;
    document.getElementById("stat-vacantes").innerText = registros.filter(r => r.modulo === "Vacantes").length;
    document.getElementById("stat-empleados").innerText = registros.filter(r => r.modulo === "Empleados").length;
    document.getElementById("stat-usuarios").innerText = registros.filter(r => r.modulo === "Usuarios").length;
  }

  function renderizarTabla(registros) {
    tablaBody.innerHTML = "";
    if (registros.length === 0) {
      tablaBody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-500">No hay registros que coincidan con la búsqueda.</td></tr>`;
      return;
    }
    registros.forEach((reg, index) => {
      const fechaObj = new Date(reg.fecha);
      const fecha = fechaObj.toLocaleDateString("es-ES") + " " + fechaObj.toLocaleTimeString("es-ES", {hour: '2-digit', minute:'2-digit'});
      const usuarioNombre = reg.usuarios?.nombre || "Sistema";
      const usuarioEmail = reg.usuarios?.email || "Desconocido";
      
      const moduloColor = getModuloColor(reg.modulo);
      
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-100 hover:bg-slate-50/50";
      tr.innerHTML = `
        <td class="py-3 px-6 text-slate-400 font-mono">${SecurityUtils.escapeHTML(reg.id_log)}</td>
        <td class="py-3 px-6 text-slate-500 whitespace-nowrap">${SecurityUtils.escapeHTML(fecha)}</td>
        <td class="py-3 px-6">
          <div class="font-bold text-slate-700">${SecurityUtils.escapeHTML(usuarioNombre)}</div>
          <div class="text-[10px] text-slate-400">${SecurityUtils.escapeHTML(usuarioEmail)}</div>
        </td>
        <td class="py-3 px-6">
          <span class="px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${moduloColor}">${SecurityUtils.escapeHTML(reg.modulo)}</span>
        </td>
        <td class="py-3 px-6 font-bold text-slate-700">${SecurityUtils.escapeHTML(reg.accion)}</td>
        <td class="py-3 px-6 text-slate-500">${SecurityUtils.escapeHTML(reg.detalle)}</td>
      `;
      tablaBody.appendChild(tr);
    });
  }

  function getModuloColor(modulo) {
    switch (modulo) {
      case "Vacantes": return "bg-blue-50 text-blue-600";
      case "Empleados": return "bg-emerald-50 text-emerald-600";
      case "Usuarios": return "bg-orange-50 text-orange-600";
      case "Base Conocimiento": return "bg-purple-50 text-purple-600";
      default: return "bg-slate-100 text-slate-600";
    }
  }

  function filtrarYRenderizar() {
    const term = buscador.value.toLowerCase();
    const modulo = filtroModulo.value;

    const filtrados = registrosGlobales.filter(r => {
      const matchTerm = r.accion.toLowerCase().includes(term) || 
                        r.detalle.toLowerCase().includes(term) || 
                        (r.usuarios?.nombre || "").toLowerCase().includes(term) ||
                        (r.usuarios?.email || "").toLowerCase().includes(term);
      const matchModulo = modulo ? r.modulo === modulo : true;
      return matchTerm && matchModulo;
    });

    actualizarStats(filtrados);
    renderizarTabla(filtrados);
  }

  buscador.addEventListener("input", filtrarYRenderizar);
  filtroModulo.addEventListener("change", filtrarYRenderizar);
  selectLimite.addEventListener("change", cargarBitacora);
  btnRefrescar.addEventListener("click", () => {
    btnRefrescar.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Refrescando`;
    cargarBitacora().then(() => {
      btnRefrescar.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Refrescar`;
    });
  });

  cargarBitacora();
});
