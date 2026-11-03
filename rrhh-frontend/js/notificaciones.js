'use strict';
document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace('index.html');
    return;
  }
  const token = AuthService.obtenerToken();
  const usuario = AuthService.obtenerUsuario();
  const nombreAdmin = document.getElementById('info-admin');
  if (nombreAdmin) nombreAdmin.textContent = usuario?.nombre || 'Administrador';
  document.getElementById('btn-logout')?.addEventListener('click', () => AuthService.cerrarSesion());

  const cuerpo = document.getElementById('notificaciones-email-body');
  const total = document.getElementById('total-notificaciones');
  const estado = document.getElementById('filtro-notificaciones-estado');
  const paginaTexto = document.getElementById('paginacion-notificaciones');
  const btnAnterior = document.getElementById('pag-anterior');
  const btnSiguiente = document.getElementById('pag-siguiente');
  const selector = document.getElementById('plantilla-evento');
  const asunto = document.getElementById('plantilla-asunto');
  const preview = document.getElementById('plantilla-preview');
  let pagina = 1;
  let cantidad = 0;
  const limite = 20;

  async function solicitar(ruta) {
    const respuesta = await fetch(`${CONFIG.API_URL}/admin/notificaciones${ruta}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let json;
    try { json = await respuesta.json(); } catch (_) { throw new Error('El servidor no devolvió una respuesta válida.'); }
    if (!respuesta.ok || !json.exito) throw new Error(json.error || 'No fue posible consultar las notificaciones.');
    return json;
  }

  function celda(fila, texto, clase = 'px-5 py-4 text-slate-700') {
    const td = document.createElement('td');
    td.className = clase;
    td.textContent = texto ?? '—';
    fila.appendChild(td);
  }

  const ETIQUETAS = Object.freeze({
    postulacion_recibida:'Postulación recibida', en_revision:'En revisión', entrevista:'Entrevista',
    contratado:'Contratado', descartado:'Descartado',
  });
  const ESTADOS = Object.freeze({
    pendiente:'Pendiente', procesando:'Procesando', aceptado_proveedor:'Aceptado por proveedor',
    fallido:'Fallido', cancelado:'Cancelado',
  });

  async function cargarListado() {
    cuerpo.replaceChildren();
    const cargando = document.createElement('tr');
    const columna = document.createElement('td');
    columna.colSpan = 5;
    columna.className = 'p-8 text-center text-slate-500';
    columna.textContent = 'Consultando historial de notificaciones...';
    cargando.append(columna);
    cuerpo.append(cargando);
    try {
      const filtro = estado.value ? `&estado=${encodeURIComponent(estado.value)}` : '';
      const resultado = await solicitar(`?pagina=${pagina}&limite=${limite}${filtro}`);
      cantidad = resultado.total;
      total.textContent = String(cantidad);
      cuerpo.replaceChildren();
      if (!resultado.registros.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'p-10 text-center text-slate-500';
        td.textContent = 'Aún no hay eventos registrados. Los eventos nuevos aparecerán cuando se registre una postulación o cambie su estado en el ATS.';
        tr.append(td);
        cuerpo.append(tr);
      }
      for (const n of resultado.registros) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50';
        celda(tr, n.nombre_candidato, 'px-5 py-4 font-bold text-slate-900');
        celda(tr, n.destinatario_email);
        celda(tr, ETIQUETAS[n.tipo_evento] || n.tipo_evento);
        celda(tr, ESTADOS[n.estado] || n.estado);
        celda(tr, n.creado_en ? new Date(n.creado_en).toLocaleString('es-HN') : '—');
        cuerpo.append(tr);
      }
      const paginas = Math.max(1, Math.ceil(cantidad / limite));
      paginaTexto.textContent = `Página ${pagina} de ${paginas}`;
      btnAnterior.disabled = pagina <= 1;
      btnSiguiente.disabled = pagina >= paginas;
    } catch (error) {
      cuerpo.replaceChildren();
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'p-8 text-center text-rose-600';
      td.textContent = error.message;
      tr.append(td);
      cuerpo.append(tr);
      total.textContent = '—';
      NotificationService.error('No fue posible cargar las notificaciones', error.message);
    }
  }

  async function cargarPlantillas() {
    try {
      const resultado = await solicitar('/plantillas');
      selector.replaceChildren();
      for (const item of resultado.eventos) {
        const option = document.createElement('option');
        option.value = item.codigo;
        option.textContent = item.etiqueta;
        selector.append(option);
      }
      await previsualizar();
    } catch (error) {
      asunto.textContent = 'No fue posible cargar las plantillas.';
      NotificationService.error('Error de plantillas', error.message);
    }
  }

  async function previsualizar() {
    if (!selector.value) return;
    asunto.textContent = 'Preparando vista previa...';
    try {
      const resultado = await solicitar(`/plantillas/${encodeURIComponent(selector.value)}`);
      asunto.textContent = resultado.asunto;
      preview.srcdoc = resultado.html;
    } catch (error) {
      asunto.textContent = error.message;
      preview.srcdoc = '';
    }
  }

  estado.addEventListener('change', () => { pagina = 1; cargarListado(); });
  selector.addEventListener('change', previsualizar);
  document.getElementById('btn-recargar-notificaciones').addEventListener('click', cargarListado);
  btnAnterior.addEventListener('click', () => { if (pagina > 1) { pagina--; cargarListado(); } });
  btnSiguiente.addEventListener('click', () => { if (pagina * limite < cantidad) { pagina++; cargarListado(); } });
  cargarListado();
  cargarPlantillas();
});
