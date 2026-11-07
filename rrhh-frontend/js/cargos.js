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

  const tbody = document.getElementById("tabla-cargos-body");
  const input = document.getElementById("cargo-nombre");
  const form = document.getElementById("form-cargo");
  const guardar = document.getElementById("btn-guardar-cargo");
  let cargos = [], editId = null;

  async function load() {
    const data = await request("cargos");
    if (!data) return;
    cargos = data.cargos || [];
    document.getElementById("total-cargos").textContent = `${cargos.length} cargos`;
    render();
  }
  function render() {
    const search = document.getElementById("buscar-cargo").value.trim().toLowerCase();
    const filtered = cargos.filter(c => c.nombre.toLowerCase().includes(search));
    tbody.innerHTML = filtered.length ? filtered.map(c => `<tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="p-4 text-slate-500">${Number(c.id_cargo)}</td>
      <td class="p-4 font-bold text-blue-950">${escape(c.nombre)}</td>
      <td class="p-4 text-right whitespace-nowrap"><button data-action="edit" data-id="${Number(c.id_cargo)}" class="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg font-bold mr-2">Editar</button><button data-action="delete" data-id="${Number(c.id_cargo)}" class="px-3 py-2 bg-rose-50 text-rose-700 rounded-lg font-bold">Eliminar</button></td>
    </tr>`).join("") : '<tr><td colspan="3" class="p-6 text-center text-slate-500">No hay cargos para mostrar.</td></tr>';
  }
  function reset() { editId = null; form.reset(); guardar.textContent = "Crear cargo"; }
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = input.value.trim();
    if (nombre.length < 2) return NotificationService.warning("Nombre inválido", "Utiliza al menos dos caracteres.");
    guardar.disabled = true;
    try {
      const data = await request(editId ? `cargos/${editId}` : "cargos", { method: editId ? "PUT" : "POST", body: JSON.stringify({ nombre }) });
      if (data) { NotificationService.success(editId ? "Cargo actualizado" : "Cargo creado", "El catálogo se actualizó correctamente."); reset(); await load(); }
    } catch (_) { NotificationService.error("Sin conexión", "Verifica tu conexión al servidor."); }
    finally { guardar.disabled = false; }
  });
  tbody.addEventListener("click", async e => {
    const b = e.target.closest("button[data-action]"); if (!b) return;
    const c = cargos.find(x => String(x.id_cargo) === b.dataset.id); if (!c) return;
    if (b.dataset.action === "edit") { editId = c.id_cargo; input.value = c.nombre; guardar.textContent = "Guardar cambios"; input.focus(); return; }
    if (!await DialogService.confirm(`¿Eliminar el cargo «${c.nombre}»?`, { title: 'Eliminar cargo laboral', variant: 'danger', confirmText: 'Eliminar cargo' })) return;
    const data = await request(`cargos/${c.id_cargo}`, { method: "DELETE" });
    if (data) { NotificationService.success("Cargo eliminado", "El registro fue retirado."); await load(); }
  });
  document.getElementById("buscar-cargo").addEventListener("input", render);
  document.getElementById("btn-limpiar-cargo").addEventListener("click", reset);
  load();
});
