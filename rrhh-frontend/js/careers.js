// Portal público TalentAI: vacantes y postulación real mediante /api/public.
// No requiere autenticación del visitante.
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const contenedor = document.getElementById("contenedor-vacantes");
  const contador = document.getElementById("contador-vacantes");
  const buscar = document.getElementById("buscar-vacante");
  const filtrar = document.getElementById("filtro-departamento");
  const modal = document.getElementById("modal-aplicacion");
  const modalExito = document.getElementById("modal-exito");
  const form = document.getElementById("form-aplicacion");
  const btnEnviar = document.getElementById("btn-enviar-aplicacion");
  const inputPDF = document.getElementById("c-archivo-cv");
  const nombrePDF = document.getElementById("nombre-archivo");
  const tituloModal = document.getElementById("titulo-vacante-modal");
  const idModal = document.getElementById("c-id-vacante");
  let vacantesActivas = [];
  let enviando = false;
  let botonDeOrigen = null;

  const notificar = (tipo, titulo, mensaje, duracion) => {
    if (typeof NotificationService !== "undefined") {
      NotificationService[tipo]?.(titulo, mensaje, duracion);
    } else {
      console.warn(`${titulo}: ${mensaje}`);
    }
  };
  const departamentoDe = (v) => {
    if (typeof v.departamentos === "string") return v.departamentos;
    return v.departamentos?.nombre || v.departamento || "Sin departamento";
  };
  const normalizar = (valor) => String(valor ?? "").toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const elemento = (etiqueta, clase, contenido) => {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (contenido != null) el.textContent = String(contenido);
    return el;
  };

  const mostrarModal = (ventana) => {
    ventana.classList.remove("hidden");
    const panel = ventana.querySelector(".transform");
    requestAnimationFrame(() => panel?.classList.replace("scale-95", "scale-100"));
    ventana.querySelector('[role="dialog"]')?.focus();
    document.body.style.overflow = "hidden";
  };
  const ocultarModal = (ventana) => {
    const panel = ventana.querySelector(".transform");
    panel?.classList.replace("scale-100", "scale-95");
    ventana.classList.add("hidden");
    document.body.style.overflow = "";
    if (botonDeOrigen?.isConnected) botonDeOrigen.focus();
  };
  const abrirAplicacion = (vacante, button) => {
    botonDeOrigen = button;
    idModal.value = vacante.id_vacante;
    tituloModal.textContent = vacante.titulo || "Vacante";
    mostrarModal(modal);
  };
  const cerrarAplicacion = () => {
    if (enviando) return;
    ocultarModal(modal);
    form.reset();
    nombrePDF.textContent = "Formato PDF. Máx. 5 MB.";
  };
  const cerrarExito = () => ocultarModal(modalExito);

  document.getElementById("btn-cerrar-modal")?.addEventListener("click", cerrarAplicacion);
  document.getElementById("btn-cerrar-exito")?.addEventListener("click", cerrarExito);
  [modal, modalExito].forEach(ventana => ventana?.addEventListener("click", (event) => {
    if (event.target === ventana) {
      if (ventana === modal) cerrarAplicacion();
      else cerrarExito();
    }
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!modalExito.classList.contains("hidden")) cerrarExito();
    else if (!modal.classList.contains("hidden")) cerrarAplicacion();
  });

  inputPDF.addEventListener("change", () => {
    const archivo = inputPDF.files?.[0];
    nombrePDF.textContent = archivo ? archivo.name : "Formato PDF. Máx. 5 MB.";
    if (archivo && (archivo.size > 5 * 1024 * 1024 || !archivo.name.toLowerCase().endsWith(".pdf"))) {
      inputPDF.value = "";
      nombrePDF.textContent = "Formato PDF. Máx. 5 MB.";
      notificar("warning", "Archivo no válido", "Selecciona un PDF de hasta 5 MB.");
    }
  });

  const estadoVacio = (mensaje, icono = "fa-briefcase", permitirReintento = false) => {
    contenedor.replaceChildren();
    const caja = elemento("div", "vacancy-placeholder");
    const icon = elemento("i", `fa-solid ${icono}`);
    icon.setAttribute("aria-hidden", "true");
    caja.append(icon, elemento("span", "", mensaje));
    if (permitirReintento) {
      const btn = elemento("button", "vacancy-retry", "Volver a intentar");
      btn.type = "button";
      btn.addEventListener("click", cargarVacantesPublicas);
      caja.appendChild(btn);
    }
    contenedor.appendChild(caja);
  };
  const crearTarjeta = (vacante) => {
    const card = elemento("article", "vacancy-card");
    const top = elemento("div", "vacancy-card-top");
    const depto = elemento("span", "vacancy-department", departamentoDe(vacante));
    const icon = elemento("i", "fa-solid fa-arrow-up-right-dots vacancy-card-icon");
    icon.setAttribute("aria-hidden", "true");
    top.append(depto, icon);
    const organization = elemento("div", "vacancy-employer-unknown", "Empresa publicadora: perfil pendiente de configurar");
    const titulo = elemento("h3", "", vacante.titulo || "Vacante");
    const descripcion = elemento("p", "", vacante.descripcion_puesto || "Consulta los detalles de esta oportunidad.");
    const requisitos = elemento("div", "vacancy-req");
    const check = elemento("i", "fa-solid fa-circle-check");
    check.setAttribute("aria-hidden", "true");
    requisitos.append(check, document.createTextNode(vacante.requisitos || "Ver detalles de la vacante"));
    const boton = elemento("button", "vacancy-apply", "Postularme a esta vacante");
    boton.type = "button";
    boton.addEventListener("click", () => abrirAplicacion(vacante, boton));
    card.append(top, organization, titulo, descripcion, requisitos, boton);
    return card;
  };
  const renderizar = () => {
    const termino = normalizar(buscar?.value).trim();
    const departamento = filtrar?.value || "";
    const filtradas = vacantesActivas.filter(v => {
      if (departamento && departamentoDe(v) !== departamento) return false;
      return !termino || normalizar([v.titulo, v.descripcion_puesto, v.requisitos, departamentoDe(v)].join(" ")).includes(termino);
    });
    if (!filtradas.length) {
      estadoVacio(vacantesActivas.length ? "No encontramos vacantes con esos filtros." : "No hay posiciones abiertas en este momento.", "fa-magnifying-glass");
      return;
    }
    contenedor.replaceChildren(...filtradas.map(crearTarjeta));
  };

  async function cargarVacantesPublicas() {
    estadoVacio("Consultando las vacantes disponibles...", "fa-spinner");
    try {
      const vacantes = await PublicVacanciesAPI.cargarVacantes();
      vacantesActivas = vacantes.filter(v => v.estado === "Abierta" || v.estado === "Activa");
      contador.textContent = `${vacantesActivas.length} ${vacantesActivas.length === 1 ? "vacante" : "vacantes"}`;
      const deptos = [...new Set(vacantesActivas.map(departamentoDe))].sort((a, b) => a.localeCompare(b, "es"));
      filtrar.replaceChildren(new Option("Todos los departamentos", ""), ...deptos.map(d => new Option(d, d)));
      renderizar();
    } catch (error) {
      console.error("Error al consultar vacantes:", { api: PublicVacanciesAPI.apiBaseURL(), error });
      contador.textContent = "Temporalmente no disponibles";
      estadoVacio(PublicVacanciesAPI.friendlyMessage(error), "fa-circle-exclamation", true);
    }
  }
  buscar?.addEventListener("input", renderizar);
  filtrar?.addEventListener("change", renderizar);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (enviando || !form.reportValidity()) return;
    const archivo = inputPDF.files?.[0];
    if (!archivo || archivo.size > 5 * 1024 * 1024 || !archivo.name.toLowerCase().endsWith(".pdf")) {
      notificar("warning", "Revisa tu currículum", "Adjunta un archivo PDF válido de hasta 5 MB.");
      return;
    }
    enviando = true;
    const botonOriginal = btnEnviar.innerHTML;
    btnEnviar.disabled = true;
    btnEnviar.textContent = "Enviando postulación...";
    try {
      const datos = new FormData();
      datos.append("id_vacante", idModal.value);
      datos.append("nombre", document.getElementById("c-nombre").value.trim());
      datos.append("correo", document.getElementById("c-correo").value.trim());
      datos.append("telefono", document.getElementById("c-telefono").value.trim());
      datos.append("linkedin", document.getElementById("c-linkedin").value.trim());
      datos.append("archivo_cv", archivo);
      const respuesta = await fetch(`${PublicVacanciesAPI.apiBaseURL()}/public/aplicar`, { method: "POST", body: datos });
      const data = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !data.exito) {
        if (respuesta.status === 409) {
          notificar("warning", "Ya existe una postulación", data.error || "Este correo ya tiene una postulación para esta vacante.", 7000);
        } else if (typeof NotificationService !== "undefined") {
          NotificationService.apiError(respuesta, data, "No pudimos procesar tu postulación.");
        } else {
          notificar("error", "No pudimos procesar tu postulación", data.error || "Inténtalo nuevamente.");
        }
        return;
      }
      // Evitar conservar datos en el formulario una vez aceptada la postulación.
      enviando = false;
      cerrarAplicacion();
      mostrarModal(modalExito);
    } catch (error) {
      console.error("Error al enviar postulación:", error);
      notificar("error", "No pudimos enviar tu postulación", "Comprueba tu conexión y vuelve a intentarlo.");
    } finally {
      enviando = false;
      btnEnviar.disabled = false;
      btnEnviar.innerHTML = botonOriginal;
    }
  });

  cargarVacantesPublicas();
});
