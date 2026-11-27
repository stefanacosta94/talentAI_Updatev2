// TalentAI | Cierre 05 | Auditoría: lectura, filtros y exportación solo del lote cargado.
document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace(AuthService.estaAutenticado() ? 'chat-empleado.html' : 'index.html'); return;
  }
  const token=AuthService.obtenerToken(), usuario=AuthService.obtenerUsuario();
  const infoAdmin=document.getElementById('info-admin');
  if(infoAdmin) infoAdmin.textContent=usuario?.nombre || 'Administrador';
  document.getElementById('btn-logout')?.addEventListener('click',()=>AuthService.cerrarSesion());

  const body=document.getElementById('tabla-bitacora-body');
  const limite=document.getElementById('filtro-limite');
  const refrescar=document.getElementById('btn-refrescar');
  const buscar=document.getElementById('buscador-bitacora');
  const modulo=document.getElementById('filtro-modulo');
  const desde=document.getElementById('audit-fecha-desde');
  const hasta=document.getElementById('audit-fecha-hasta');
  const resultados=document.getElementById('audit-resultados');
  const actualizado=document.getElementById('audit-actualizado');
  let registros=[], visibles=[], cargando=false;
  const esc=SecurityUtils.escapeHTML;

  function formatLocalDate(value) {
    const fecha = new Date(value);
    if(Number.isNaN(fecha.getTime()))return '—';
    return new Intl.DateTimeFormat('es-HN', {dateStyle:'short',timeStyle:'short'}).format(fecha);
  }
  function fechaCalendario(value) {
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function colorModulo(value) {
    const normal=String(value||'').toLocaleLowerCase('es');
    if(normal.includes('vacante'))return 'bg-blue-50 text-blue-700';
    if(normal.includes('empleado'))return 'bg-emerald-50 text-emerald-700';
    if(normal.includes('usuario'))return 'bg-orange-50 text-orange-700';
    if(normal.includes('aplicacion')||normal.includes('ats'))return 'bg-indigo-50 text-indigo-700';
    if(normal.includes('conocimiento'))return 'bg-purple-50 text-purple-700';
    return 'bg-slate-100 text-slate-700';
  }
  function refrescarModuloOpciones() {
    const seleccionado=modulo.value;
    const valores=[...new Set(registros.map(x=>String(x.modulo||'Sin módulo')))].sort((a,b)=>a.localeCompare(b,'es'));
    modulo.innerHTML='<option value="">Todos los módulos</option>'+valores.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if(valores.includes(seleccionado))modulo.value=seleccionado;
  }
  function actualizarStats(lista) {
    const suma=f=>lista.filter(f).length;
    document.getElementById('stat-total-logs').textContent=String(lista.length);
    document.getElementById('stat-vacantes').textContent=String(suma(r=>String(r.modulo||'').toLowerCase().includes('vacante')));
    document.getElementById('stat-empleados').textContent=String(suma(r=>String(r.modulo||'').toLowerCase().includes('empleado')));
    document.getElementById('stat-usuarios').textContent=String(suma(r=>String(r.modulo||'').toLowerCase().includes('usuario')));
    document.getElementById('stat-ats').textContent=String(suma(r=>/ats|aplicacion/i.test(String(r.modulo||''))));
    resultados.textContent=`Mostrando ${lista.length} de los últimos ${registros.length} eventos cargados (límite solicitado: ${limite.value}). Los filtros no consultan el historial completo.`;
  }
  function render(lista) {
    body.innerHTML=lista.length ? lista.map(r=>{
      const id=String(r.id_log||'');
      const shortId=id.length>13?`${id.slice(0,8)}…`:id;
      const nombre=r.usuarios?.nombre||'Sistema';
      const email=r.usuarios?.email||'';
      const detalle=String(r.detalle||'Sin detalle');
      const moduloName=String(r.modulo||'Sin módulo');
      return `<tr class="border-b border-slate-100">
        <td class="p-4 align-middle"><span class="audit-id-text text-slate-500" title="${esc(id)}">${esc(shortId)}</span><br><button type="button" class="text-blue-600 text-[10px] font-bold hover:underline mt-1" data-copiar-id="${esc(id)}" aria-label="Copiar ID del evento">Copiar ID</button></td>
        <td class="p-4 text-slate-500 whitespace-nowrap"><time datetime="${esc(r.fecha||'')}">${esc(formatLocalDate(r.fecha))}</time></td>
        <td class="p-4"><div class="font-bold text-blue-950">${esc(nombre)}</div><div class="text-[11px] text-slate-500">${esc(email)}</div></td>
        <td class="p-4"><span class="inline-flex px-2.5 py-1 rounded-lg text-[10px] font-extrabold ${colorModulo(moduloName)}">${esc(moduloName)}</span></td>
        <td class="p-4 font-semibold text-slate-700">${esc(r.accion||'Acción sin nombre')}</td>
        <td class="p-4 text-slate-600"><details class="audit-detail-text"><summary class="font-semibold text-blue-700 cursor-pointer select-none">Ver detalle</summary><p class="mt-2 leading-relaxed break-words">${esc(detalle)}</p></details></td>
      </tr>`;
    }).join(''):'<tr><td colspan="6" class="p-8 text-center text-slate-500">No hay eventos que coincidan con la búsqueda o el rango seleccionado.</td></tr>';
  }
  function filtrar() {
    const term=buscar.value.trim().toLocaleLowerCase('es');
    const area=modulo.value;
    visibles=registros.filter(r=>{
      const texto=`${r.accion||''} ${r.detalle||''} ${r.modulo||''} ${r.usuarios?.nombre||''} ${r.usuarios?.email||''} ${r.id_log||''}`.toLocaleLowerCase('es');
      const dia=fechaCalendario(r.fecha);
      return texto.includes(term) && (!area || r.modulo===area)
        && (!desde.value || (dia && dia>=desde.value))
        && (!hasta.value || (dia && dia<=hasta.value));
    });
    actualizarStats(visibles);render(visibles);
  }
  async function cargar(){
    if(cargando)return;
    cargando=true;refrescar.disabled=true;
    refrescar.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i> Actualizando';
    try {
      const cantidad=Number(limite.value);
      if(![25,50,100,200].includes(cantidad)) throw new Error('Límite de consulta inválido');
      const res=await fetch(`${CONFIG.API_URL}/admin/bitacora?limite=${cantidad}`,{
        headers:{Authorization:`Bearer ${token}`},
      });
      const data=await res.json();
      if(!res.ok || !data.exito){NotificationService.apiError(res,data,'No se pudo cargar la bitácora.');return;}
      registros=Array.isArray(data.registros)?data.registros:[];
      refrescarModuloOpciones();filtrar();
      actualizado.textContent=`Actualizado: ${new Intl.DateTimeFormat('es-HN',{dateStyle:'short',timeStyle:'short'}).format(new Date())}`;
    } catch(error) {
      NotificationService.error('No se pudo cargar la bitácora',error.message||'Comprueba tu conexión.');
      if(!registros.length)body.innerHTML='<tr><td colspan="6" class="p-8 text-center text-rose-600">Error al cargar. Usa Refrescar para reintentar.</td></tr>';
    } finally {
      cargando=false;refrescar.disabled=false;
      refrescar.innerHTML='<i class="fa-solid fa-arrows-rotate"></i> Refrescar';
    }
  }
  // Evitar CSV injection al abrir registros de auditoría en una hoja de cálculo.
  function campoCsv(value) {
    let t=String(value??'').replace(/\r?\n/g,' ');
    if(/^[\s]*[=+@-]/.test(t))t=`'${t}`;
    return `"${t.replace(/"/g,'""')}"`;
  }
  function exportar(){
    if(!visibles.length)return NotificationService.info('Sin datos','No hay registros para exportar en la vista actual.');
    const columns=['ID evento','Fecha ISO','Usuario','Correo','Módulo','Acción','Detalle'];
    const rows=visibles.map(r=>[r.id_log,r.fecha,r.usuarios?.nombre||'Sistema',r.usuarios?.email||'',r.modulo,r.accion,r.detalle]);
    const contenido='\ufeff'+[columns,...rows].map(row=>row.map(campoCsv).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([contenido],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download=`TalentAI_Bitacora_Vista_${fechaCalendario(new Date())}.csv`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  body.addEventListener('click',async e=>{
    const button=e.target.closest('button[data-copiar-id]');if(!button)return;
    try { await navigator.clipboard.writeText(button.dataset.copiarId||'');
      NotificationService.success('ID copiado','Puedes utilizarlo para identificar el evento.');
    } catch (_) { NotificationService.warning('No se pudo copiar','Selecciona el ID manualmente.'); }
  });
  [buscar,modulo,desde,hasta].forEach(el=>{
    el.addEventListener('input',filtrar);el.addEventListener('change',filtrar);
  });
  document.getElementById('audit-limpiar-filtros').addEventListener('click',()=>{
    buscar.value='';modulo.value='';desde.value='';hasta.value='';filtrar();
  });
  document.getElementById('audit-exportar-csv').addEventListener('click',exportar);
  limite.addEventListener('change',cargar);
  refrescar.addEventListener('click',cargar);
  cargar();
});
