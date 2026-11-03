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

  async function solicitar(ruta, metodo = 'GET', datos = undefined) {
    const respuesta = await fetch(`${CONFIG.API_URL}/admin/notificaciones${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(datos === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
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
    fallido:'Fallido', cancelado:'Cancelado', requiere_revision:'Requiere revisión',
  });

  async function cargarListado() {
    cuerpo.replaceChildren();
    const cargando = document.createElement('tr');
    const columna = document.createElement('td');
    columna.colSpan = 7;
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
        td.colSpan = 7;
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
        const estadoAprobacion = n.datos?.requiere_aprobacion === true && n.datos?.aprobado_envio !== true;
        celda(tr, (ESTADOS[n.estado] || n.estado) + (estadoAprobacion ? ' · Sin aprobar' : ''));
        celda(tr, `${n.intentos ?? 0}/${n.max_intentos ?? 5}`);
        const tdAcciones = document.createElement('td');
        tdAcciones.className = 'p-3';
        const acciones = [];
        if (estadoAprobacion && ['pendiente','fallido'].includes(n.estado)) acciones.push(['aprobar','Aprobar']);
        if (['pendiente','fallido','requiere_revision'].includes(n.estado)) acciones.push(['cancelar','Cancelar']);
        if (['fallido','requiere_revision'].includes(n.estado) && n.intentos < n.max_intentos) acciones.push(['reprogramar','Reprogramar']);
        acciones.push(['intentos','Historial']);
        for (const [accion, titulo] of acciones) {
          const boton = document.createElement('button');
          boton.type = 'button';
          boton.className = 'text-blue-700 border border-blue-100 rounded-md text-[11px] font-bold px-2 py-1 mr-1 mb-1 hover:bg-blue-50';
          boton.textContent = titulo;
          boton.dataset.accion = accion;
          boton.dataset.id = n.id_notificacion;
          tdAcciones.append(boton);
        }
        tr.append(tdAcciones);
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
      td.colSpan = 7;
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

  const btnProcesar = document.getElementById('btn-procesar-simulacion');
  const btnConciliar = document.getElementById('btn-conciliar-recepciones');
  const dialog = document.getElementById('dialog-intentos');
  const contenidoIntentos = document.getElementById('contenido-intentos');

  async function accionFila(id, accion) {
    if (accion === 'intentos') {
      const respuesta = await solicitar(`/${encodeURIComponent(id)}/intentos`);
      contenidoIntentos.replaceChildren();
      if (!respuesta.intentos.length) {
        const p = document.createElement('p');
        p.textContent = 'Sin intentos registrados todavía.';
        contenidoIntentos.append(p);
      }
      for (const intento of respuesta.intentos) {
        const p = document.createElement('p');
        p.className = 'border-b border-slate-100 py-2';
        p.textContent = `${intento.resultado} · ${intento.codigo_diagnostico} · ${new Date(intento.creado_en).toLocaleString('es-HN')}`;
        contenidoIntentos.append(p);
      }
      dialog.showModal();
      return;
    }
    const mensajes = {
      aprobar:'¿Confirmas que esta comunicación puede procesarse cuando se habilite el envío real?',
      cancelar:'¿Cancelar esta notificación? No volverá a procesarse automáticamente.',
      reprogramar:'¿Confirmas que revisaste el evento y deseas reprogramarlo? Si hubo un procesamiento incierto, verifica antes el proveedor.',
    };
    if (!window.confirm(mensajes[accion])) return;
    await solicitar(`/${encodeURIComponent(id)}/${accion}`, 'POST');
    NotificationService.success('Notificación actualizada', 'La operación quedó registrada.');
    await cargarListado();
  }

  cuerpo.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton || boton.disabled) return;
    boton.disabled = true;
    try { await accionFila(boton.dataset.id, boton.dataset.accion); }
    catch (error) { NotificationService.error('No fue posible completar la acción', error.message); }
    finally { boton.disabled = false; }
  });
  document.getElementById('btn-cerrar-intentos').addEventListener('click', () => dialog.close());

  btnProcesar.addEventListener('click', async () => {
    if (!window.confirm('Esta acción solo SIMULA el procesamiento. No enviará correos reales. ¿Continuar?')) return;
    btnProcesar.disabled = true;
    try {
      const r = await solicitar('/procesar-simulacion', 'POST', { limite: 10 });
      NotificationService.info('Simulación completada', `${r.simuladas} simuladas, ${r.fallidas} fallidas y ${r.sin_finalizar} por revisar. Ningún correo fue enviado.`);
      await cargarListado();
    } catch (error) { NotificationService.error('No fue posible simular', error.message); }
    finally { btnProcesar.disabled = false; }
  });
  btnConciliar.addEventListener('click', async () => {
    if (!window.confirm('La conciliación solo recuperará recepciones desde el corte de Fase 5B y las dejará pendientes de aprobación. ¿Continuar?')) return;
    btnConciliar.disabled = true;
    try {
      const r = await solicitar('/conciliar-recepciones', 'POST', { limite: 100 });
      NotificationService.info('Conciliación finalizada', `${r.recuperadas} recepciones recuperadas. Los cambios de estado históricos no se reconstruyen.`);
      await cargarListado();
    } catch (error) { NotificationService.error('No fue posible conciliar', error.message); }
    finally { btnConciliar.disabled = false; }
  });

  estado.addEventListener('change', () => { pagina = 1; cargarListado(); });
  selector.addEventListener('change', previsualizar);
  document.getElementById('btn-recargar-notificaciones').addEventListener('click', cargarListado);
  btnAnterior.addEventListener('click', () => { if (pagina > 1) { pagina--; cargarListado(); } });
  btnSiguiente.addEventListener('click', () => { if (pagina * limite < cantidad) { pagina++; cargarListado(); } });
  cargarListado();
  cargarPlantillas();
});
