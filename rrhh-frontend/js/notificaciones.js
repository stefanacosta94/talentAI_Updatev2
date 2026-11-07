'use strict';
// TalentAI - Centro de notificaciones: presentación y consultas. No cambia
// autorizaciones, destinatarios ni la semántica de los RPC de la Fase 8A.
document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.estaAutenticado() || !AuthService.esAdmin()) {
    window.location.replace('index.html');
    return;
  }

  const token = AuthService.obtenerToken();
  document.getElementById('info-admin').textContent = AuthService.obtenerUsuario()?.nombre || 'Administrador';
  document.getElementById('btn-logout')?.addEventListener('click', () => AuthService.cerrarSesion());
  const $ = (id) => document.getElementById(id);

  const cuerpo = $('notificaciones-email-body');
  const filtroEstado = $('filtro-notificaciones-estado');
  const filtroEvento = $('filtro-notificaciones-evento');
  const filtroModo = $('filtro-notificaciones-modo');
  const filtroBuscar = $('buscar-notificaciones');
  const btnAnterior = $('pag-anterior');
  const btnSiguiente = $('pag-siguiente');
  const btnProcesar = $('btn-procesar-simulacion');
  const btnResend = $('btn-procesar-resend-prueba');
  const btnConciliar = $('btn-conciliar-recepciones');
  const btnActualizar = $('btn-recargar-notificaciones');
  const detalleDialog = $('dialog-detalle');
  const intentosDialog = $('dialog-intentos');
  const panelPlantillas = $('panel-plantillas');

  const ETIQUETAS = Object.freeze({
    postulacion_recibida: 'Postulación recibida',
    en_revision: 'En revisión',
    entrevista: 'Entrevista',
    contratado: 'Contratado',
    descartado: 'Descartado',
  });
  const ICONOS_EVENTO = Object.freeze({
    postulacion_recibida: 'fa-file-lines', en_revision: 'fa-magnifying-glass',
    entrevista: 'fa-users', contratado: 'fa-circle-check', descartado: 'fa-user-xmark',
  });
  const ESTADOS = Object.freeze({
    pendiente: 'Pendiente', procesando: 'Procesando',
    aceptado_proveedor: 'Aceptado por Resend', fallido: 'Fallido',
    cancelado: 'Cancelado', requiere_revision: 'Requiere revisión',
  });
  const ICONOS_ESTADO = Object.freeze({
    pendiente: 'fa-hourglass-half', procesando: 'fa-arrows-rotate',
    aceptado_proveedor: 'fa-check', fallido: 'fa-xmark',
    cancelado: 'fa-ban', requiere_revision: 'fa-triangle-exclamation',
  });

  const limite = 20;
  let pagina = 1;
  let cantidad = 0;
  let peticionListado = 0;
  let modoEnvio = 'mock';
  let resendConfigurado = false;
  let resendAutoHabilitado = false;
  let filasActuales = new Map();
  let plantillasCargadas = false;
  let timerBusqueda;

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
    try { json = await respuesta.json(); }
    catch (_) { throw new Error('El servidor no devolvió una respuesta válida.'); }
    if (!respuesta.ok || json.exito !== true) {
      throw new Error(json.error || 'No fue posible consultar las notificaciones.');
    }
    return json;
  }

  function elemento(etiqueta, clase = '', texto) {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto ?? '—';
    return nodo;
  }
  function icono(clase) {
    const i = elemento('i', `fa-solid ${clase}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function texto(id, valor) { $(id).textContent = valor == null ? '—' : String(valor); }
  function fecha(valor, corta = false) {
    if (!valor) return '—';
    const date = new Date(valor);
    if (Number.isNaN(date.valueOf())) return '—';
    return new Intl.DateTimeFormat('es-HN', corta
      ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    ).format(date);
  }
  function crearBoton(accion, etiqueta, id, tipo = 'outline') {
    const boton = elemento('button', `nc-btn nc-btn-${tipo}`, etiqueta);
    boton.type = 'button';
    boton.dataset.accion = accion;
    boton.dataset.id = id;
    return boton;
  }
  function esSinAprobar(n) {
    return n.datos?.requiere_aprobacion === true && n.datos?.aprobado_envio !== true;
  }
  function tipoEnvio(n) {
    // El indicador describe AUTORIZACIÓN, no prueba que el envío haya ocurrido.
    if (n.auto_resend_autorizado === true) return ['Auto. (prueba)', 'nc-type nc-type-auto', 'fa-bolt'];
    if (n.prueba_resend_autorizada === true) return ['Manual (prueba)', 'nc-type', 'fa-paper-plane'];
    return ['Sin autorizar', 'nc-type', 'fa-lock'];
  }
  function accionesDisponibles(n) {
    const acciones = [];
    const sinAprobar = esSinAprobar(n);
    if (sinAprobar && ['pendiente', 'fallido'].includes(n.estado)) acciones.push(['aprobar', 'Aprobar comunicación']);
    if (['pendiente', 'fallido', 'requiere_revision'].includes(n.estado)) acciones.push(['cancelar', 'Cancelar']);
    if (['fallido', 'requiere_revision'].includes(n.estado) && Number(n.intentos) < Number(n.max_intentos)
        && !(n.estado === 'requiere_revision' && n.prueba_resend_autorizada)) {
      acciones.push(['reprogramar', 'Reprogramar tras revisión']);
    }
    if (modoEnvio === 'resend_test' && resendConfigurado && !n.prueba_resend_autorizada
        && ['pendiente', 'fallido'].includes(n.estado) && !sinAprobar) {
      acciones.push(['autorizar-prueba-resend', 'Autorizar prueba Resend']);
    }
    if (resendAutoHabilitado && n.prueba_resend_autorizada && !n.auto_resend_autorizado
        && n.estado === 'pendiente' && !sinAprobar) {
      acciones.push(['autorizar-auto-resend', 'Activar automático (prueba)']);
    }
    if (n.auto_resend_autorizado && ['pendiente', 'fallido'].includes(n.estado)) {
      acciones.push(['revocar-auto-resend', 'Revocar automático']);
    }
    return acciones;
  }

  function pintarVacio(mensaje, clase = 'nc-empty') {
    cuerpo.replaceChildren();
    const fila = elemento('tr');
    const celda = elemento('td', clase, mensaje);
    celda.colSpan = 7;
    fila.append(celda);
    cuerpo.append(fila);
  }

  function pintarFila(n) {
    const tr = elemento('tr');
    const candidato = elemento('td');
    const candidatoBox = elemento('div', 'nc-candidate');
    const avatar = elemento('span', 'nc-avatar');
    avatar.append(icono('fa-user'));
    const identidad = elemento('div');
    identidad.append(
      elemento('p', 'nc-candidate-name', n.nombre_candidato || 'Sin nombre'),
      elemento('p', 'nc-candidate-email', n.destinatario_email || 'Sin correo')
    );
    candidatoBox.append(avatar, identidad);
    candidato.append(candidatoBox);
    tr.append(candidato);

    const evento = elemento('td');
    const eventoCaja = elemento('span', 'nc-event');
    eventoCaja.append(icono(ICONOS_EVENTO[n.tipo_evento] || 'fa-envelope'),
      elemento('span', '', ETIQUETAS[n.tipo_evento] || n.tipo_evento || '—'));
    evento.append(eventoCaja);
    tr.append(evento);

    const celdaEstado = elemento('td');
    const estadoBadge = elemento('span', `nc-state nc-state-${Object.hasOwn(ESTADOS, n.estado) ? n.estado : 'cancelado'}`);
    estadoBadge.append(icono(ICONOS_ESTADO[n.estado] || 'fa-circle-info'),
      elemento('span', '', ESTADOS[n.estado] || n.estado || '—'));
    celdaEstado.append(estadoBadge);
    if (esSinAprobar(n)) celdaEstado.append(elemento('small', 'nc-row-note', 'Requiere aprobación'));
    tr.append(celdaEstado);

    const tipo = elemento('td');
    const [tituloTipo, claseTipo, iconoTipo] = tipoEnvio(n);
    const tipoBadge = elemento('span', claseTipo);
    tipoBadge.append(icono(iconoTipo), elemento('span', '', tituloTipo));
    tipo.append(tipoBadge);
    tr.append(tipo);

    tr.append(elemento('td', 'nc-attempt-count', `${n.intentos ?? 0}/${n.max_intentos ?? 5}`));
    tr.append(elemento('td', 'nc-date', fecha(n.enviado_en || n.creado_en, true)));

    const tdAcciones = elemento('td');
    const opciones = elemento('div', 'nc-row-actions');
    const btnDetalle = crearBoton('detalle', 'Ver detalle', n.id_notificacion);
    btnDetalle.prepend(icono('fa-eye'));
    const btnHistorial = crearBoton('intentos', 'Historial', n.id_notificacion);
    btnHistorial.prepend(icono('fa-clock-rotate-left'));
    opciones.append(btnDetalle, btnHistorial);
    tdAcciones.append(opciones);
    tr.append(tdAcciones);
    return tr;
  }

  function parametrosListado() {
    const query = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
    if (filtroEstado.value) query.set('estado', filtroEstado.value);
    if (filtroEvento.value) query.set('evento', filtroEvento.value);
    if (filtroModo.value) query.set('modo', filtroModo.value);
    const busqueda = filtroBuscar.value.trim();
    if (busqueda) query.set('buscar', busqueda);
    return query.toString();
  }
  async function cargarListado() {
    const solicitudId = ++peticionListado;
    pintarVacio('Consultando historial de notificaciones...');
    try {
      const datos = await solicitar(`?${parametrosListado()}`);
      if (solicitudId !== peticionListado) return;
      cantidad = Number(datos.total || 0);
      filasActuales = new Map(datos.registros.map((n) => [String(n.id_notificacion), n]));
      cuerpo.replaceChildren();
      if (!datos.registros.length) {
        pintarVacio(cantidad === 0 && ![filtroEstado.value, filtroEvento.value, filtroModo.value, filtroBuscar.value.trim()].some(Boolean)
          ? 'Aún no hay notificaciones. Se crearán cuando ingresen postulaciones o cambie una etapa del ATS.'
          : 'No se encontraron notificaciones con los filtros seleccionados.');
      } else {
        for (const n of datos.registros) cuerpo.append(pintarFila(n));
      }
      const maxPagina = Math.max(1, Math.ceil(cantidad / limite));
      texto('paginacion-notificaciones', `Página ${pagina} de ${maxPagina}`);
      texto('etiqueta-registros', `${cantidad} registro${cantidad === 1 ? '' : 's'}`);
      texto('detalle-filtros', `Mostrando ${datos.registros.length} en esta página${[filtroEstado.value, filtroEvento.value, filtroModo.value, filtroBuscar.value.trim()].some(Boolean) ? ' · Filtros aplicados' : ''}`);
      btnAnterior.disabled = pagina <= 1;
      btnSiguiente.disabled = pagina >= maxPagina;
    } catch (error) {
      if (solicitudId !== peticionListado) return;
      pintarVacio(error.message);
      texto('etiqueta-registros', 'No disponible');
      texto('detalle-filtros', 'No fue posible obtener el listado');
      btnAnterior.disabled = true;
      btnSiguiente.disabled = true;
      NotificationService.error('No fue posible cargar las notificaciones', error.message);
    }
  }

  async function cargarResumen() {
    try {
      const datos = await solicitar('/resumen');
      texto('total-notificaciones', datos.total);
      texto('kpi-pendientes', datos.pendientes);
      texto('kpi-aceptados', datos.aceptados);
      texto('kpi-fallidos', datos.fallidos);
      texto('kpi-revision', `${datos.revision ?? 0} en revisión`);
      texto('kpi-ultimo-evento', fecha(datos.ultimo_evento_en, true));
      texto('servicio-ultima', fecha(datos.ultimo_evento_en, true));
    } catch (_) {
      ['total-notificaciones', 'kpi-pendientes', 'kpi-aceptados', 'kpi-fallidos',
        'kpi-revision', 'kpi-ultimo-evento', 'servicio-ultima'].forEach((id) => texto(id, '—'));
      // La tabla sigue disponible aunque falle este endpoint de lectura.
    }
  }

  async function cargarConfiguracion() {
    try {
      const datos = await solicitar('/configuracion-envio');
      modoEnvio = datos.modo;
      resendConfigurado = datos.configurado === true;
      resendAutoHabilitado = datos.automatico === true;
      const pruebas = modoEnvio === 'resend_test';
      btnProcesar.hidden = pruebas;
      btnResend.hidden = !pruebas || !resendConfigurado;
      texto('servicio-proveedor', pruebas ? 'Resend' : 'Simulación');
      const modo = $('servicio-modo');
      modo.className = `nc-mini-pill ${pruebas && resendAutoHabilitado ? 'nc-pill-green' : 'nc-pill-neutral'}`;
      modo.textContent = pruebas ? (resendAutoHabilitado ? 'Pruebas automáticas' : 'Pruebas manuales') : 'Simulación';
      const habilitadoReal = datos.destinatario_real_habilitado === true;
      const reales = $('servicio-reales');
      reales.className = `nc-mini-pill ${habilitadoReal ? 'nc-pill-red' : 'nc-pill-amber'}`;
      reales.textContent = habilitadoReal ? 'Verificar configuración' : 'Desactivado';
      texto('aviso-resend-prueba', pruebas
        ? (resendConfigurado
          ? (resendAutoHabilitado
            ? `Pruebas automáticas habilitadas (cada ${Math.round(Number(datos.intervaloMs) / 1000)} s). Cada mensaje requiere autorización individual; se usan destinatario fijo y datos ficticios, nunca el correo del candidato.`
            : 'Resend configurado para pruebas manuales. El envío automático está desactivado; no se enviarán correos a candidatos.')
          : 'Resend no tiene la configuración de pruebas completa; comprueba el backend antes de habilitar envíos.')
        : 'Simulación activa. No se enviarán correos mediante el proveedor.');
    } catch (_) {
      resendConfigurado = false;
      resendAutoHabilitado = false;
      btnProcesar.hidden = true;
      btnResend.hidden = true;
      texto('servicio-modo', 'No disponible');
      texto('servicio-proveedor', 'Sin confirmar');
      texto('aviso-resend-prueba', 'No fue posible consultar la configuración. No actives envíos hasta revisar el backend.');
    }
  }

  function datoDetalle(contenedor, etiqueta, valor) {
    const dl = elemento('dl', 'nc-detail-entry');
    dl.append(elemento('dt', '', etiqueta), elemento('dd', '', valor == null ? '—' : String(valor)));
    contenedor.append(dl);
  }
  function mostrarDetalle(n) {
    const contenido = $('contenido-detalle');
    const acciones = $('acciones-detalle');
    contenido.replaceChildren();
    acciones.replaceChildren();
    datoDetalle(contenido, 'Candidato', n.nombre_candidato || '—');
    datoDetalle(contenido, 'Correo registrado', n.destinatario_email || '—');
    datoDetalle(contenido, 'Vacante', n.titulo_vacante || '—');
    datoDetalle(contenido, 'Evento', ETIQUETAS[n.tipo_evento] || n.tipo_evento);
    datoDetalle(contenido, 'Estado de procesamiento', ESTADOS[n.estado] || n.estado);
    datoDetalle(contenido, 'Tipo de autorización', tipoEnvio(n)[0]);
    datoDetalle(contenido, 'Intentos', `${n.intentos ?? 0}/${n.max_intentos ?? 5}`);
    datoDetalle(contenido, 'Creado', fecha(n.creado_en));
    datoDetalle(contenido, 'Aceptado por proveedor', fecha(n.enviado_en));
    datoDetalle(contenido, 'ID de Resend', n.id_mensaje_proveedor || 'Sin ID registrado');
    datoDetalle(contenido, 'Aprobación de comunicación', esSinAprobar(n) ? 'Pendiente de aprobación' : 'Sin bloqueo de aprobación');
    datoDetalle(contenido, 'Prueba Resend', n.prueba_resend_autorizada ? 'Autorizada' : 'No autorizada');
    datoDetalle(contenido, 'Despacho automático de prueba', n.auto_resend_autorizado ? 'Autorizado' : 'No autorizado');
    if (n.estado === 'aceptado_proveedor') {
      $('dialog-detalle').querySelector('.nc-dialog-note').textContent = 'Resend aceptó el mensaje, pero la entrega aún no está confirmada. La confirmación de entrega requiere webhooks.';
    } else {
      $('dialog-detalle').querySelector('.nc-dialog-note').textContent = 'Las acciones disponibles dependen del estado y de las autorizaciones de cada notificación. El correo real del candidato no se utiliza en pruebas.';
    }
    for (const [accion, etiqueta] of accionesDisponibles(n)) {
      const btn = crearBoton(accion, etiqueta, n.id_notificacion, accion === 'cancelar' ? 'danger' : 'outline');
      acciones.append(btn);
    }
    acciones.append(crearBoton('intentos', 'Ver historial de intentos', n.id_notificacion, 'primary'));
    detalleDialog.showModal();
  }

  async function verIntentos(id) {
    const respuesta = await solicitar(`/${encodeURIComponent(id)}/intentos`);
    const contenedor = $('contenido-intentos');
    contenedor.replaceChildren();
    if (!respuesta.intentos.length) contenedor.append(elemento('p', 'nc-attempt', 'Todavía no hay intentos registrados.'));
    for (const intento of respuesta.intentos) {
      const resultado = String(intento.resultado || 'Sin resultado');
      const diagnostico = String(intento.codigo_diagnostico || '—');
      contenedor.append(elemento('p', 'nc-attempt', `${resultado} · ${diagnostico} · ${fecha(intento.creado_en)}`));
    }
    if (detalleDialog.open) detalleDialog.close();
    intentosDialog.showModal();
  }

  const CONFIRMACIONES = Object.freeze({
    'autorizar-prueba-resend': '¿Autorizas esta notificación para UNA PRUEBA con Resend? Se usarán datos ficticios y el destinatario fijo del backend; nunca el correo del candidato.',
    'autorizar-auto-resend': '¿Habilitar el despacho AUTOMÁTICO de PRUEBA para ESTA notificación? Express podría enviarla en el siguiente ciclo sin intervención adicional, únicamente al correo de pruebas.',
    'revocar-auto-resend': '¿Revocar el envío automático de esta notificación? No detendrá un envío que ya haya comenzado.',
    aprobar: '¿Apruebas esta comunicación para que pueda ser procesada en el futuro?',
    cancelar: '¿Cancelar esta notificación? No volverá a ser procesada.',
    reprogramar: '¿Confirmas que revisaste el evento y deseas reprogramarlo? Si hubo un intento incierto, verifica antes el proveedor.',
  });

  const TITULOS_CONFIRMACION = Object.freeze({
    'autorizar-prueba-resend': 'Autorizar prueba de correo',
    'autorizar-auto-resend': 'Activar prueba automática',
    'revocar-auto-resend': 'Revocar envío automático',
    aprobar: 'Aprobar comunicación',
    cancelar: 'Cancelar notificación',
    reprogramar: 'Reprogramar notificación',
  });
  const BOTONES_CONFIRMACION = Object.freeze({
    'autorizar-prueba-resend': 'Autorizar prueba',
    'autorizar-auto-resend': 'Activar automático',
    'revocar-auto-resend': 'Revocar autorización',
    aprobar: 'Aprobar',
    cancelar: 'Sí, cancelar',
    reprogramar: 'Reprogramar',
  });

  async function accionFila(id, accion) {
    if (accion === 'detalle') {
      const n = filasActuales.get(String(id));
      if (n) mostrarDetalle(n);
      return;
    }
    if (accion === 'intentos') return verIntentos(id);
    if (!Object.prototype.hasOwnProperty.call(CONFIRMACIONES, accion)) return;
    if (!await DialogService.confirm(CONFIRMACIONES[accion], {
      title: TITULOS_CONFIRMACION[accion],
      variant: ['cancelar', 'revocar-auto-resend'].includes(accion) ? 'danger' : 'warning',
      confirmText: BOTONES_CONFIRMACION[accion],
    })) return;
    await solicitar(`/${encodeURIComponent(id)}/${accion}`, 'POST');
    NotificationService.success('Notificación actualizada', 'La operación quedó registrada.');
    if (detalleDialog.open) detalleDialog.close();
    await refrescarDatos();
  }

  async function manejarAccion(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton || boton.disabled) return;
    boton.disabled = true;
    try { await accionFila(boton.dataset.id, boton.dataset.accion); }
    catch (error) { NotificationService.error('No fue posible completar la acción', error.message); }
    finally { boton.disabled = false; }
  }
  cuerpo.addEventListener('click', manejarAccion);
  $('acciones-detalle').addEventListener('click', manejarAccion);
  $('btn-cerrar-detalle').addEventListener('click', () => detalleDialog.close());
  $('btn-cerrar-intentos').addEventListener('click', () => intentosDialog.close());

  async function refrescarDatos() {
    await Promise.all([cargarResumen(), cargarListado()]);
  }
  async function refrescarTodo() {
    btnActualizar.disabled = true;
    try { await cargarConfiguracion(); await refrescarDatos(); }
    finally { btnActualizar.disabled = false; }
  }

  btnProcesar.addEventListener('click', async () => {
    if (btnProcesar.disabled) return;
    btnProcesar.disabled = true;
    try {
      if (!await DialogService.confirm('Se simulará el procesamiento de las notificaciones pendientes. No se enviará ningún correo.', { title: 'Simular procesamiento', variant: 'info', confirmText: 'Iniciar simulación' })) return;
      const r = await solicitar('/procesar-simulacion', 'POST', { limite: 10 });
      NotificationService.info('Simulación completada', `${r.simuladas} simuladas, ${r.fallidas} fallidas, ${r.sin_finalizar} por revisar. Ningún correo enviado.`);
      await refrescarDatos();
    } catch (error) { NotificationService.error('Error de simulación', error.message); }
    finally { btnProcesar.disabled = false; }
  });
  btnResend.addEventListener('click', async () => {
    if (btnResend.disabled) return;
    btnResend.disabled = true;
    try {
      if (!await DialogService.confirm('Se realizará un único intento de envío con Resend, al destinatario controlado y utilizando datos ficticios. La aceptación no confirma la entrega.', { title: 'Enviar correo de prueba', variant: 'warning', confirmText: 'Enviar prueba' })) return;
      const r = await solicitar('/procesar-resend-prueba', 'POST', {});
      NotificationService.info('Prueba Resend', `${r.aceptadas} aceptada(s) por el proveedor, ${r.rechazadas} rechazada(s), ${r.inciertas} incierta(s), ${r.sin_finalizar} sin finalizar. Aceptación no equivale a entrega.`);
      await refrescarDatos();
    } catch (error) { NotificationService.error('Error de prueba', error.message); }
    finally { btnResend.disabled = false; }
  });
  btnConciliar.addEventListener('click', async () => {
    if (btnConciliar.disabled) return;
    btnConciliar.disabled = true;
    try {
      if (!await DialogService.confirm('Se recuperarán las recepciones faltantes en estado pendiente. No se reconstruirá el historial de transiciones ni se enviarán correos.', { title: 'Conciliar notificaciones', variant: 'info', confirmText: 'Conciliar registros' })) return;
      const r = await solicitar('/conciliar-recepciones', 'POST', { limite: 100 });
      NotificationService.info('Conciliación finalizada', `${r.recuperadas} recepciones recuperadas. No se reconstruyen transiciones históricas.`);
      await refrescarDatos();
    } catch (error) { NotificationService.error('Error de conciliación', error.message); }
    finally { btnConciliar.disabled = false; }
  });

  function restablecerFiltros() { pagina = 1; cargarListado(); }
  [filtroEstado, filtroEvento, filtroModo].forEach((f) => f.addEventListener('change', restablecerFiltros));
  filtroBuscar.addEventListener('input', () => {
    clearTimeout(timerBusqueda);
    timerBusqueda = setTimeout(restablecerFiltros, 350);
  });
  filtroBuscar.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') { evento.preventDefault(); clearTimeout(timerBusqueda); restablecerFiltros(); }
  });
  btnActualizar.addEventListener('click', refrescarTodo);
  btnAnterior.addEventListener('click', () => { if (pagina > 1) { pagina--; cargarListado(); } });
  btnSiguiente.addEventListener('click', () => { if (pagina * limite < cantidad) { pagina++; cargarListado(); } });

  async function cargarPlantillas() {
    if (plantillasCargadas) return;
    const selector = $('plantilla-evento');
    try {
      const respuesta = await solicitar('/plantillas');
      selector.replaceChildren();
      for (const plantilla of respuesta.eventos) {
        const opcion = elemento('option', '', plantilla.etiqueta);
        opcion.value = plantilla.codigo;
        selector.append(opcion);
      }
      plantillasCargadas = true;
      await previsualizar();
    } catch (error) {
      texto('plantilla-asunto', 'No fue posible cargar las plantillas.');
      NotificationService.error('Error de plantillas', error.message);
    }
  }
  async function previsualizar() {
    const selector = $('plantilla-evento');
    if (!selector.value) return;
    texto('plantilla-asunto', 'Preparando vista previa...');
    try {
      const plantilla = await solicitar(`/plantillas/${encodeURIComponent(selector.value)}`);
      texto('plantilla-asunto', plantilla.asunto);
      // HTML sólo de la plantilla generada por el backend, en iframe sin permisos.
      $('plantilla-preview').srcdoc = plantilla.html;
    } catch (error) {
      texto('plantilla-asunto', error.message);
      $('plantilla-preview').srcdoc = '';
    }
  }
  panelPlantillas.addEventListener('toggle', () => { if (panelPlantillas.open) cargarPlantillas(); });
  $('plantilla-evento').addEventListener('change', previsualizar);

  refrescarTodo();
});
