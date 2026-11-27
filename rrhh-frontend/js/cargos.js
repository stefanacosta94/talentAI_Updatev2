// Cierre 05: catálogo de cargos y su departamento organizacional (independiente de RBAC).
document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace(AuthService.estaAutenticado() ? 'chat-empleado.html' : 'index.html'); return;
  }
  const token = AuthService.obtenerToken();
  const nombreAdmin = document.getElementById('info-admin');
  if (nombreAdmin) nombreAdmin.textContent = AuthService.obtenerUsuario()?.nombre || 'Administrador';
  document.getElementById('btn-logout')?.addEventListener('click', () => AuthService.cerrarSesion());
  const esc = SecurityUtils.escapeHTML;
  const tbody = document.getElementById('tabla-cargos-body');
  const form = document.getElementById('form-cargo');
  const nombreInput = document.getElementById('cargo-nombre');
  const deptoInput = document.getElementById('cargo-departamento');
  const btnGuardar = document.getElementById('btn-guardar-cargo');
  const btnCancelar = document.getElementById('btn-limpiar-cargo');
  const indicador = document.getElementById('cargo-edit-indicator');
  const buscar = document.getElementById('buscar-cargo');
  const filtroDepto = document.getElementById('filtro-departamento-cargos');
  let cargos = [], departamentos = [], editarId = null;
  // Modal accesible, sin modificar el contrato CRUD del catálogo.
  const modal = document.getElementById('modal-cargo');
  const dialogo = modal.querySelector('[role="dialog"]');
  const tituloModal = document.getElementById('modal-cargo-titulo');
  const nuevo = document.getElementById('btn-nuevo-cargo');
  const cerrarBtn = document.getElementById('btn-cerrar-modal-cargo');
  let focoPrevio = null;
  function abrirModal(edicion = false) {
    focoPrevio = document.activeElement;
    tituloModal.textContent = edicion ? 'Editar cargo' : 'Nuevo cargo';
    modal.hidden = false;
    document.body.classList.add('admin-modal-open');
    nombreInput.focus();
  }
  function cerrarModal() {
    if (btnGuardar.disabled) return;
    modal.hidden = true;
    document.body.classList.remove('admin-modal-open');
    reset();
    focoPrevio?.focus?.();
  }
  nuevo.addEventListener('click', () => {reset();abrirModal();});
  cerrarBtn.addEventListener('click', cerrarModal);
  modal.addEventListener('click', (e) => {if (e.target === modal) cerrarModal();});
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {e.preventDefault();cerrarModal();return;}
    if (e.key !== 'Tab') return;
    const focos = [...dialogo.querySelectorAll('input:not(:disabled), select:not(:disabled), button:not(:disabled)')];
    if (!focos.length) return;
    if (e.shiftKey && document.activeElement === focos[0]) { e.preventDefault();focos.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === focos.at(-1)) { e.preventDefault();focos[0].focus(); }
  });


  async function request(path, options={}) {
    const res = await fetch(`${CONFIG.API_URL}/admin/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    let data;
    try { data = await res.json(); }
    catch (_) { throw new Error('El servidor devolvió una respuesta no válida.'); }
    if (!res.ok || !data.exito) {
      NotificationService.apiError(res, data, 'No se pudo completar la operación.');
      return null;
    }
    return data;
  }

  function departamentoNombre(id) {
    if (!id) return 'Sin asignar';
    return departamentos.find(d => String(d.id_departamento) === String(id))?.nombre || 'Departamento no encontrado';
  }
  function render() {
    const termino = buscar.value.trim().toLocaleLowerCase('es');
    const d = filtroDepto.value;
    const filtrados = [...cargos]
      .filter(c => `${c.nombre} ${departamentoNombre(c.id_departamento)}`.toLocaleLowerCase('es').includes(termino))
      .filter(c => d === '' || (d === '_sin_' ? !c.id_departamento : String(c.id_departamento) === d))
      .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
    tbody.innerHTML = filtrados.length ? filtrados.map((c,i) => `<tr class="border-b border-slate-100">
      <td class="p-4 admin-id" title="ID interno: ${Number(c.id_cargo)}">${i+1}</td>
      <td class="p-4 font-bold text-blue-950">${esc(c.nombre)}</td>
      <td class="p-4"><span class="${c.id_departamento ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'} rounded-lg px-2.5 py-1 font-semibold">${esc(departamentoNombre(c.id_departamento))}</span></td>
      <td class="p-4 text-right whitespace-nowrap"><div class="admin-row-actions">
        <button type="button" class="admin-action admin-action-edit" data-action="edit" data-id="${Number(c.id_cargo)}" aria-label="Editar cargo ${esc(c.nombre)}">Editar</button>
        <button type="button" class="admin-action admin-action-delete" data-action="delete" data-id="${Number(c.id_cargo)}" aria-label="Eliminar cargo ${esc(c.nombre)}">Eliminar</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="4" class="p-7 text-center text-slate-500">No hay cargos que coincidan con los filtros.</td></tr>';
  }
  function reset() {
    editarId = null; form.reset(); btnGuardar.textContent='Crear cargo';
    indicador.classList.add('hidden');
  }
  function rellenarDepartamentos() {
    const opts = departamentos.map(d=>`<option value="${Number(d.id_departamento)}">${esc(d.nombre)}</option>`).join('');
    deptoInput.innerHTML = `<option value="">Sin departamento asignado</option>${opts}`;
    filtroDepto.innerHTML = `<option value="">Todas las áreas</option><option value="_sin_">Sin departamento</option>${opts}`;
  }
  async function load() {
    const [deps, cs] = await Promise.all([request('departamentos'),request('cargos')]);
    if (!deps || !cs) return;
    departamentos = deps.departamentos || [];
    cargos = cs.cargos || [];
    rellenarDepartamentos();
    document.getElementById('total-cargos').textContent=`${cargos.length} cargos`;
    render();
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const nombre = nombreInput.value.trim();
    if (nombre.length < 2) return NotificationService.warning('Nombre inválido', 'Utiliza al menos dos caracteres.');
    if (btnGuardar.disabled) return;
    btnGuardar.disabled = true;
    try {
      const data = await request(editarId ? `cargos/${editarId}` : 'cargos', {
        method: editarId ? 'PUT' : 'POST',
        body: JSON.stringify({ nombre, id_departamento: deptoInput.value || null }),
      });
      if (data) {
        NotificationService.success(editarId ? 'Cargo actualizado' : 'Cargo creado', 'El catálogo se actualizó correctamente.');
        await load(); btnGuardar.disabled=false; cerrarModal();
      }
    } catch (_) { NotificationService.error('Sin conexión', 'Comprueba la conexión con el servidor.'); }
    finally { btnGuardar.disabled = false; }
  });
  tbody.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]'); if (!button || button.disabled) return;
    const cargo = cargos.find(c => String(c.id_cargo)===button.dataset.id); if (!cargo) return;
    if (button.dataset.action === 'edit') {
      editarId = cargo.id_cargo; nombreInput.value=cargo.nombre;
      deptoInput.value=String(cargo.id_departamento || '');
      indicador.textContent=`Editando: ${cargo.nombre}`; indicador.classList.remove('hidden');
      btnGuardar.textContent='Guardar cambios';
      abrirModal(true); return;
    }
    if (!await DialogService.confirm(`¿Eliminar el cargo «${cargo.nombre}»? Los cargos asignados a empleados no pueden eliminarse.`, {
      title:'Eliminar cargo laboral', variant:'danger', confirmText:'Eliminar cargo',
    })) return;
    button.disabled = true;
    try {
      const data = await request(`cargos/${cargo.id_cargo}`, {method:'DELETE'});
      if (data) { NotificationService.success('Cargo eliminado', 'El ID interno no se reutilizará.'); await load(); }
    } catch (_) { NotificationService.error('Error de conexión', 'No fue posible eliminar el cargo.'); }
    finally { button.disabled = false; }
  });
  buscar.addEventListener('input',render);
  filtroDepto.addEventListener('change',render);
  btnCancelar.addEventListener('click',cerrarModal);
  load().catch(()=> NotificationService.error('Sin conexión','No se pudieron cargar cargos o departamentos.'));
});
