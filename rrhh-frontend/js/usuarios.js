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
  
  let usuariosGlobales = [];
  let usuarioEditandoId = null;

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
          <button data-action="editar" data-id="${usr.id}" class="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold rounded-lg mr-2 transition-all">Editar</button>
          <button data-action="eliminar" data-id="${usr.id}" class="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold rounded-lg transition-all" ${usr.id === usuario.id ? 'disabled title="No puedes eliminarte a ti mismo"' : ''}>Eliminar</button>
        </td>
      `;
      tablaBody.appendChild(tr);
    });
  }

  function resetFormulario() {
    usuarioEditandoId = null;
    formUsuario.reset();
    document.getElementById("form-usuario-titulo").textContent = "Crear nuevo usuario";
    document.getElementById("usr-password-label").textContent = "Contraseña *";
    document.getElementById("usr-password").required = true;
    document.getElementById("usr-rol-wrapper").classList.remove("hidden");
  }

  btnNuevoUsuario?.addEventListener("click", () => {
    resetFormulario();
    formContainer.classList.remove("hidden");
  });

  btnCancelarUsuario?.addEventListener("click", () => {
    formContainer.classList.add("hidden");
    resetFormulario();
  });

  formUsuario?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      nombre: document.getElementById("usr-nombre").value,
      email: document.getElementById("usr-email").value,
      password: document.getElementById("usr-password").value,
    };
    if (!usuarioEditandoId) payload.rol = document.getElementById("usr-rol").value;
    const esEdicion = Boolean(usuarioEditandoId);

    try {
      const { res, data } = await fetchJson(esEdicion ? `${CONFIG.API_URL}/admin/usuarios/${usuarioEditandoId}` : `${CONFIG.API_URL}/admin/usuarios`, {
        method: esEdicion ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok && data.exito) {
        formContainer.classList.add("hidden");
        resetFormulario();
        await cargarUsuarios();
        NotificationService.success(esEdicion ? "Usuario actualizado" : "Usuario creado", "El registro se guardó correctamente.");
      } else {
        NotificationService.apiError(res, data, esEdicion ? "No fue posible actualizar el usuario." : "No fue posible crear el usuario.");
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

    if (action === "editar" && usr) {
      resetFormulario();
      usuarioEditandoId = usr.id;
      document.getElementById("form-usuario-titulo").textContent = "Editar usuario";
      document.getElementById("usr-nombre").value = usr.nombre;
      document.getElementById("usr-email").value = usr.email;
      document.getElementById("usr-password-label").textContent = "Nueva contraseña (opcional)";
      document.getElementById("usr-password").required = false;
      document.getElementById("usr-rol-wrapper").classList.add("hidden");
      formContainer.classList.remove("hidden");
      formContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "eliminar" && usr) {
      if (await DialogService.confirm(`¿Estás seguro de eliminar el acceso a ${usr.nombre}?`, { title: 'Revocar acceso de usuario', variant: 'danger', confirmText: 'Eliminar acceso' })) {
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


  document.getElementById("buscador-usuarios")?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = usuariosGlobales.filter(u => 
      u.nombre.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
    renderizarTabla(filtrados);
  });

  cargarUsuarios();
});
