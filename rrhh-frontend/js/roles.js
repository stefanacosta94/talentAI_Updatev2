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

  const rolesBody = document.getElementById("tabla-roles-body");
  const usuariosBody = document.getElementById("tabla-usuarios-roles");
  let users = [];
  function render() {
    const count = role => users.filter(u => u.rol === role).length;
    rolesBody.innerHTML = [
      { id: "admin", desc: "Administración de recursos, cuentas, documentación y ATS" },
      { id: "empleado", desc: "Acceso al asistente de Recursos Humanos" }
    ].map(r => `<tr class="border-b border-slate-100"><td class="p-4 font-extrabold text-blue-950">${r.id}</td><td class="p-4 text-slate-600">${r.desc}</td><td class="p-4">${count(r.id)}</td></tr>`).join("");
    const filter = document.getElementById("buscar-usuario-rol").value.trim().toLowerCase();
    const filtered = users.filter(u => `${u.nombre} ${u.email}`.toLowerCase().includes(filter));
    usuariosBody.innerHTML = filtered.length ? filtered.map(u => `
      <tr class="border-b border-slate-100 hover:bg-slate-50"><td class="p-4 font-bold text-blue-950">${escape(u.nombre)}</td><td class="p-4 text-slate-500">${escape(u.email)}</td><td class="p-4"><select aria-label="Rol de ${escape(u.nombre)}" data-role-id="${escape(u.id)}" class="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs" ${u.id === currentUser?.id ? 'disabled title="No puedes retirarte el rol de administrador"' : ''}><option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>admin</option><option value="empleado" ${u.rol === 'empleado' ? 'selected' : ''}>empleado</option></select></td><td class="p-4 text-right"><button data-save-id="${escape(u.id)}" class="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-bold" ${u.id === currentUser?.id ? 'disabled' : ''}>Guardar rol</button></td></tr>`).join("") : '<tr><td colspan="4" class="p-6 text-center text-slate-500">No hay usuarios para mostrar.</td></tr>';
  }
  async function load() {
    const data = await request("usuarios"); if (!data) return;
    users = data.usuarios || [];
    render();
  }
  usuariosBody.addEventListener("click", async e => {
    const btn = e.target.closest("button[data-save-id]"); if (!btn) return;
    const id = btn.dataset.saveId;
    const selected = [...usuariosBody.querySelectorAll("select[data-role-id]")].find(el => el.dataset.roleId === id);
    const usr = users.find(x => x.id === id);
    if (!selected || !usr || id === currentUser?.id) return;
    if (selected.value === usr.rol) return NotificationService.info("Sin cambios", "El usuario ya tiene ese rol.");
    if (!confirm(`¿Cambiar el rol de ${usr.nombre} a ${selected.value}?`)) { selected.value = usr.rol; return; }
    btn.disabled = true;
    try {
      const data = await request(`usuarios/${encodeURIComponent(id)}/rol`, { method: "PUT", body: JSON.stringify({ nuevo_rol: selected.value }) });
      if (data) { NotificationService.success("Rol actualizado", "El cambio de permisos fue registrado."); await load(); }
      else selected.value = usr.rol;
    } catch (_) { NotificationService.error("Error de conexión", "No fue posible actualizar el rol."); selected.value = usr.rol; }
    finally { btn.disabled = false; }
  });
  document.getElementById("buscar-usuario-rol").addEventListener("input", render);
  load();
});
