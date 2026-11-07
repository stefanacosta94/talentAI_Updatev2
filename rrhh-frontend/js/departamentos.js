// Pantalla administrativa independiente.
document.addEventListener("DOMContentLoaded", () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace(AuthService.estaAutenticado() ? "chat-empleado.html" : "index.html");
    return;
  }
  const token = AuthService.obtenerToken();
  const currentUser = AuthService.obtenerUsuario();
  const adminName = document.getElementById("info-admin");
  if (adminName) adminName.textContent = currentUser?.nombre || "Administrador";
  document.getElementById("btn-logout")?.addEventListener("click", AuthService.cerrarSesion);
  const escape = SecurityUtils.escapeHTML;
  async function request(path, options = {}) {
    const res = await fetch(`${CONFIG.API_URL}/admin/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const data = await res.json();
    if (!res.ok || !data.exito) {
      NotificationService.apiError(res, data, "No se pudo completar la operación.");
      return null;
    }
    return data;
  }

  const tbody = document.getElementById("tabla-departamentos-body");
  const form = document.getElementById("form-departamento");
  const input = document.getElementById("departamento-nombre");
  const guardar = document.getElementById("btn-guardar-departamento");
  let records = [], editId = null;
  async function load() {
    const data = await request("departamentos"); if (!data) return;
    records = data.departamentos || [];
    document.getElementById("total-departamentos").textContent = `${records.length} departamentos`;
    render();
  }
  function render() {
    const search = document.getElementById("buscar-departamento").value.trim().toLowerCase();
    const filtered = records.filter(d => d.nombre.toLowerCase().includes(search));
    tbody.innerHTML = filtered.length ? filtered.map(d => `<tr class="border-b border-slate-100 hover:bg-slate-50"><td class="p-4 text-slate-500">${Number(d.id_departamento)}</td><td class="p-4 font-bold text-blue-950">${escape(d.nombre)}</td><td class="p-4 text-right whitespace-nowrap"><button data-action="edit" data-id="${Number(d.id_departamento)}" class="mr-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg font-bold">Editar</button><button data-action="delete" data-id="${Number(d.id_departamento)}" class="px-3 py-2 bg-rose-50 text-rose-700 rounded-lg font-bold">Eliminar</button></td></tr>`).join("") : '<tr><td colspan="3" class="p-6 text-center text-slate-500">No hay departamentos para mostrar.</td></tr>';
  }
  function reset() { editId = null; form.reset(); guardar.textContent = "Crear departamento"; }
  form.addEventListener("submit", async e => {
    e.preventDefault(); const nombre = input.value.trim();
    if (nombre.length < 2) return NotificationService.warning("Nombre inválido", "Utiliza al menos dos caracteres.");
    guardar.disabled = true;
    try {
      const data = await request(editId ? `departamentos/${editId}` : "departamentos", { method: editId ? "PUT" : "POST", body: JSON.stringify({ nombre }) });
      if (data) { NotificationService.success("Departamento guardado", "El catálogo fue actualizado."); reset(); await load(); }
    } catch (_) { NotificationService.error("Error de conexión", "No fue posible contactar con el servidor."); }
    finally { guardar.disabled = false; }
  });
  tbody.addEventListener("click", async e => {
    const b = e.target.closest("button[data-action]"); if (!b) return;
    const d = records.find(x => String(x.id_departamento) === b.dataset.id); if (!d) return;
    if (b.dataset.action === "edit") { editId = d.id_departamento; input.value = d.nombre; guardar.textContent = "Guardar cambios"; input.focus(); return; }
    if (!await DialogService.confirm(`¿Eliminar el departamento «${d.nombre}»? Si está asociado a empleados o vacantes, no podrá eliminarse.`, { title: 'Eliminar departamento', variant: 'danger', confirmText: 'Eliminar departamento' })) return;
    const data = await request(`departamentos/${d.id_departamento}`, { method: "DELETE" });
    if (data) { NotificationService.success("Departamento eliminado", "El catálogo se actualizó."); await load(); }
  });
  document.getElementById("buscar-departamento").addEventListener("input", render);
  document.getElementById("btn-limpiar-departamento").addEventListener("click", reset);
  load();
});
