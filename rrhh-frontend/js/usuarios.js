// ==========================================
// js/usuarios.js
// Controlador de Control de Accesos
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

  const tablaBody = document.getElementById("tabla-usuarios-body");
  const formContainer = document.getElementById("form-usuario-container");
  const formUsuario = document.getElementById("form-usuario");
  const btnNuevoUsuario = document.getElementById("btn-nuevo-usuario");
  const btnCancelarUsuario = document.getElementById("btn-cancelar-usuario");
  
  const modalRol = document.getElementById("modal-rol");
  const btnCancelarRol = document.getElementById("btn-cancelar-rol");
  const btnGuardarRol = document.getElementById("btn-guardar-rol");

  let usuariosGlobales = [];

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    try { return { res, data: JSON.parse(text) }; } catch(e) { throw new Error(text); }
  }

  async function cargarUsuarios() {
    try {
      const { data } = await fetchJson(`${CONFIG.API_URL}/admin/usuarios`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.exito) {
        usuariosGlobales = data.usuarios;
        renderizarTabla(usuariosGlobales);
      }
    } catch (e) {
      tablaBody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-500">Error al cargar usuarios</td></tr>`;
    }
  }

  function renderizarTabla(lista) {
    tablaBody.innerHTML = "";
    if (lista.length === 0) {
      tablaBody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-500">No hay usuarios.</td></tr>`;
      return;
    }
    lista.forEach(usr => {
      const rolClase = usr.rol === "admin" ? "bg-orange-50 border-orange-200 text-orange-600" : "bg-slate-50 border-slate-200 text-slate-600";
      const fecha = new Date(usr.created_at).toLocaleDateString("es-ES");
      
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-100 hover:bg-slate-50/50";
      tr.innerHTML = `
        <td class="py-4 px-6 font-bold text-blue-950">${SecurityUtils.escapeHTML(usr.nombre)}</td>
        <td class="py-4 px-6 text-slate-500">${SecurityUtils.escapeHTML(usr.email)}</td>
        <td class="py-4 px-6"><span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${rolClase}">${SecurityUtils.escapeHTML(usr.rol)}</span></td>
        <td class="py-4 px-6 text-slate-500">${fecha}</td>
        <td class="py-4 px-6 text-right">
          <button data-action="rol" data-id="${usr.id}" class="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold rounded-lg mr-2 transition-all">Rol</button>
          <button data-action="eliminar" data-id="${usr.id}" class="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold rounded-lg transition-all" ${usr.id === usuario.id ? 'disabled title="No puedes eliminarte a ti mismo"' : ''}>Eliminar</button>
        </td>
      `;
      tablaBody.appendChild(tr);
    });
  }

  btnNuevoUsuario?.addEventListener("click", () => {
    formContainer.classList.toggle("hidden");
    formUsuario.reset();
  });

  btnCancelarUsuario?.addEventListener("click", () => {
    formContainer.classList.add("hidden");
    formUsuario.reset();
  });

  formUsuario?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      nombre: document.getElementById("usr-nombre").value,
      email: document.getElementById("usr-email").value,
      password: document.getElementById("usr-password").value,
      rol: document.getElementById("usr-rol").value
    };

    try {
      const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/usuarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok && data.exito) {
        formContainer.classList.add("hidden");
        formUsuario.reset();
        await cargarUsuarios();
        NotificationService.success("Usuario creado", "El acceso fue creado correctamente.");
      } else {
        NotificationService.apiError(res, data, "No fue posible crear el usuario.");
      }
    } catch (err) {
      console.error("Error guardando usuario:", err);
      NotificationService.error("No pudimos crear el usuario", "Verifica la información e intenta nuevamente.");
    }
  });

  tablaBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const usr = usuariosGlobales.find(x => String(x.id) === String(id));

    if (action === "rol" && usr) {
      document.getElementById("modal-rol-user-id").value = id;
      document.getElementById("modal-rol-nombre").innerText = usr.nombre;
      document.getElementById("modal-rol-select").value = usr.rol;
      modalRol.classList.remove("hidden");
    } else if (action === "eliminar") {
      if (confirm(`¿Estás seguro de eliminar el acceso a ${SecurityUtils.escapeHTML(usr.nombre)}?`)) {
        try {
          const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/usuarios/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            await cargarUsuarios();
            NotificationService.success("Acceso eliminado", "El usuario ya no tiene acceso a la plataforma.");
          } else {
            NotificationService.apiError(res, data, "No fue posible eliminar el acceso.");
          }
        } catch (err) {
          console.error("Error al eliminar usuario:", err);
          NotificationService.error("No pudimos eliminar el acceso", "Intenta nuevamente en unos segundos.");
        }
      }
    }
  });

  btnCancelarRol?.addEventListener("click", () => modalRol.classList.add("hidden"));
  
  btnGuardarRol?.addEventListener("click", async () => {
    const id = document.getElementById("modal-rol-user-id").value;
    const nuevo_rol = document.getElementById("modal-rol-select").value;
    try {
      const { res, data } = await fetchJson(`${CONFIG.API_URL}/admin/usuarios/${id}/rol`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nuevo_rol })
      });
      if (res.ok && data.exito) {
        modalRol.classList.add("hidden");
        await cargarUsuarios();
        NotificationService.success("Rol actualizado", "Los permisos del usuario fueron actualizados.");
      } else {
        NotificationService.apiError(res, data, "No fue posible cambiar el rol.");
      }
    } catch (e) {
      console.error("Error cambiando rol:", e);
      NotificationService.error("No pudimos cambiar el rol", "Intenta nuevamente en unos segundos.");
    }
  });

  document.getElementById("buscador-usuarios")?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = usuariosGlobales.filter(u => 
      u.nombre.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
    renderizarTabla(filtrados);
  });

  cargarUsuarios();
});
