// Cierre 05: presentación numerada, claves internas permanentes y edición contextual.
document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace(AuthService.estaAutenticado() ? 'chat-empleado.html' : 'index.html'); return;
  }
  const token=AuthService.obtenerToken(), esc=SecurityUtils.escapeHTML;
  const nombreAdmin=document.getElementById('info-admin');
  if(nombreAdmin) nombreAdmin.textContent=AuthService.obtenerUsuario()?.nombre || 'Administrador';
  document.getElementById('btn-logout')?.addEventListener('click',()=>AuthService.cerrarSesion());
  const tbody=document.getElementById('tabla-departamentos-body');
  const form=document.getElementById('form-departamento');
  const input=document.getElementById('departamento-nombre');
  const guardar=document.getElementById('btn-guardar-departamento');
  const cancelar=document.getElementById('btn-limpiar-departamento');
  const indicador=document.getElementById('departamento-edit-indicator');
  const buscar=document.getElementById('buscar-departamento');
  let records=[], editarId=null;
  // Modal accesible, sin modificar el contrato CRUD del catálogo.
  const modal = document.getElementById('modal-departamento');
  const dialogo = modal.querySelector('[role="dialog"]');
  const tituloModal = document.getElementById('modal-departamento-titulo');
  const nuevo = document.getElementById('btn-nuevo-departamento');
  const cerrarBtn = document.getElementById('btn-cerrar-modal-departamento');
  let focoPrevio = null;
  function abrirModal(edicion = false) {
    focoPrevio = document.activeElement;
    tituloModal.textContent = edicion ? 'Editar departamento' : 'Nuevo departamento';
    modal.hidden = false;
    document.body.classList.add('admin-modal-open');
    input.focus();
  }
  function cerrarModal() {
    if (guardar.disabled) return;
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


  async function request(path,options={}) {
    const res=await fetch(`${CONFIG.API_URL}/admin/${path}`, {
      ...options, headers:{Authorization:`Bearer ${token}`,
        ...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},
    });
    let data;try{data=await res.json();}catch(_){throw new Error('Respuesta inválida del servidor');}
    if(!res.ok||!data.exito){NotificationService.apiError(res,data,'No se pudo completar la operación.');return null;}
    return data;
  }
  function render(){
    const term=buscar.value.trim().toLocaleLowerCase('es');
    const filtered=records.filter(d=>d.nombre.toLocaleLowerCase('es').includes(term))
      .sort((a,b)=>Number(a.id_departamento)-Number(b.id_departamento));
    tbody.innerHTML=filtered.length?filtered.map((d,i)=>`<tr class="border-b border-slate-100">
      <td class="p-4 admin-id" title="ID interno: ${Number(d.id_departamento)}">${i+1}</td>
      <td class="p-4 font-bold text-blue-950">${esc(d.nombre)}</td>
      <td class="p-4 text-right whitespace-nowrap"><div class="admin-row-actions">
        <button type="button" class="admin-action admin-action-edit" data-action="edit" data-id="${Number(d.id_departamento)}" aria-label="Editar departamento ${esc(d.nombre)}">Editar</button>
        <button type="button" class="admin-action admin-action-delete" data-action="delete" data-id="${Number(d.id_departamento)}" aria-label="Eliminar departamento ${esc(d.nombre)}">Eliminar</button>
      </div></td></tr>`).join(''):'<tr><td colspan="3" class="p-6 text-center text-slate-500">No hay departamentos que coincidan con la búsqueda.</td></tr>';
  }
  function reset(){editarId=null;form.reset();guardar.textContent='Crear departamento';indicador.classList.add('hidden');}
  async function load(){
    const data=await request('departamentos');if(!data)return;
    records=data.departamentos||[];
    document.getElementById('total-departamentos').textContent=`${records.length} departamentos`;
    render();
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();const nombre=input.value.trim();
    if(nombre.length<2)return NotificationService.warning('Nombre inválido','Utiliza al menos dos caracteres.');
    if(guardar.disabled)return;guardar.disabled=true;
    try{
      const data=await request(editarId?`departamentos/${editarId}`:'departamentos',{
        method:editarId?'PUT':'POST',body:JSON.stringify({nombre}),
      });
      if(data){NotificationService.success(editarId?'Departamento actualizado':'Departamento creado','Los cambios fueron guardados.');await load();guardar.disabled=false;cerrarModal();}
    }catch(_){NotificationService.error('Sin conexión','Verifica la comunicación con el servidor.');}
    finally{guardar.disabled=false;}
  });
  tbody.addEventListener('click',async e=>{
    const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;
    const dep=records.find(x=>String(x.id_departamento)===b.dataset.id);if(!dep)return;
    if(b.dataset.action==='edit'){
      editarId=dep.id_departamento;input.value=dep.nombre;
      guardar.textContent='Guardar cambios';
      indicador.textContent=`Editando: ${dep.nombre}`;indicador.classList.remove('hidden');abrirModal(true); return;
    }
    if(!await DialogService.confirm(`¿Eliminar el departamento «${dep.nombre}»? No se permite si está vinculado a empleados, cargos o vacantes.`,{
      title:'Eliminar departamento',variant:'danger',confirmText:'Eliminar departamento',
    }))return;
    b.disabled=true;
    try{const data=await request(`departamentos/${dep.id_departamento}`,{method:'DELETE'});
      if(data){NotificationService.success('Departamento eliminado','La numeración interna no se reutiliza.');await load();}
    }catch(_){NotificationService.error('Sin conexión','No fue posible eliminar el departamento.');}
    finally{b.disabled=false;}
  });
  buscar.addEventListener('input',render);
  cancelar.addEventListener('click',cerrarModal);
  load().catch(()=>NotificationService.error('Sin conexión','No se pudieron cargar los departamentos.'));
});
