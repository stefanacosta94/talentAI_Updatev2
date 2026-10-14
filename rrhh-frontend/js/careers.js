// ==========================================
// js/careers.js
// Lógica de la Pantalla Pública de Empleos
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  // Referencias del DOM principal
  const contenedorVacantes = document.getElementById("contenedor-vacantes");
  const contadorVacantes = document.getElementById("contador-vacantes");

  // Referencias del Modal
  const modalAplicacion = document.getElementById("modal-aplicacion");
  const btnCerrarModal = document.getElementById("btn-cerrar-modal");
  const formAplicacion = document.getElementById("form-aplicacion");
  const tituloVacanteModal = document.getElementById("titulo-vacante-modal");
  const idVacanteInput = document.getElementById("c-id-vacante");
  const inputArchivo = document.getElementById("c-archivo-cv");
  const labelNombreArchivo = document.getElementById("nombre-archivo");
  const btnEnviarAplicacion = document.getElementById("btn-enviar-aplicacion");

  // Referencias del Modal de Éxito
  const modalExito = document.getElementById("modal-exito");
  const btnCerrarExito = document.getElementById("btn-cerrar-exito");

  // 1. Mostrar nombre del archivo seleccionado
  inputArchivo.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      labelNombreArchivo.innerHTML = `<span class="text-blue-600 font-bold"><i class="fa-solid fa-file-pdf mr-1"></i> ${e.target.files[0].name}</span>`;
    } else {
      labelNombreArchivo.innerText = "Formato PDF. Máx 5MB.";
    }
  });

  // 2. Controladores del Modal
  const abrirModal = (idVacante, tituloVacante) => {
    idVacanteInput.value = idVacante;
    tituloVacanteModal.innerText = tituloVacante;
    modalAplicacion.classList.remove("hidden");
    setTimeout(() => {
      modalAplicacion.querySelector(".transform").classList.remove("scale-95");
      modalAplicacion.querySelector(".transform").classList.add("scale-100");
    }, 10);
  };

  const cerrarModal = () => {
    modalAplicacion.querySelector(".transform").classList.remove("scale-100");
    modalAplicacion.querySelector(".transform").classList.add("scale-95");
    setTimeout(() => {
      modalAplicacion.classList.add("hidden");
      formAplicacion.reset();
      labelNombreArchivo.innerText = "Formato PDF. Máx 5MB.";
    }, 200);
  };

  btnCerrarModal.addEventListener("click", cerrarModal);

  const abrirModalExito = () => {
    modalExito.classList.remove("hidden");
    setTimeout(() => {
      modalExito.querySelector(".transform").classList.remove("scale-95");
      modalExito.querySelector(".transform").classList.add("scale-100");
    }, 10);
  };

  btnCerrarExito.addEventListener("click", () => {
    modalExito.querySelector(".transform").classList.remove("scale-100");
    modalExito.querySelector(".transform").classList.add("scale-95");
    setTimeout(() => {
      modalExito.classList.add("hidden");
    }, 200);
  });

  // 3. Cargar Vacantes Públicas
  async function cargarVacantesPublicas() {
    try {
      // Nota: Esta ruta en el backend debe ser creada sin el middleware 'verificarToken'
      const respuesta = await fetch(`${CONFIG.API_URL}/public/vacantes`);
      const data = await respuesta.json();

      if (!respuesta.ok || !data.exito) throw new Error(data.error);

      // Filtrar solo las vacantes 'Abierta' o 'Activa'
      const vacantesActivas = data.vacantes.filter(
        (v) => v.estado === "Abierta" || v.estado === "Activa",
      );

      contadorVacantes.innerText = `${vacantesActivas.length} Plazas`;
      contenedorVacantes.innerHTML = "";

      if (vacantesActivas.length === 0) {
        contenedorVacantes.innerHTML = `
                    <div class="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                        <i class="fa-solid fa-briefcase text-slate-200 text-5xl mb-4"></i>
                        <p class="text-slate-500 font-semibold">No hay posiciones abiertas en este momento.</p>
                    </div>
                `;
        return;
      }

      vacantesActivas.forEach((vacante, index) => {
        const card = document.createElement("div");
        card.className =
          "bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/40 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col fade-in";
        card.style.animationDelay = `${index * 0.1}s`;

        card.innerHTML = `
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-[10px] font-black text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 uppercase tracking-widest">
                            ${vacante.departamento || "General"}
                        </span>
                        <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                            <i class="fa-solid fa-fire text-orange-500 text-[10px]"></i>
                        </div>
                    </div>
                    
                    <h4 class="text-2xl font-extrabold text-blue-950 mb-3 leading-tight">${vacante.titulo}</h4>
                    <p class="text-slate-500 text-sm mb-6 flex-grow line-clamp-3 font-medium leading-relaxed">${vacante.descripcion_puesto}</p>
                    
                    <div class="pt-5 border-t border-slate-100 mb-6">
                        <p class="text-xs text-slate-600 font-bold line-clamp-2"><i class="fa-solid fa-check text-emerald-500 mr-1"></i> ${vacante.requisitos}</p>
                    </div>
                    
                    <button type="button" class="btn-aplicar mt-auto w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-600/20" data-id="${vacante.id_vacante}" data-titulo="${vacante.titulo}">
                        Aplicar a esta plaza
                    </button>
                `;
        contenedorVacantes.appendChild(card);
      });

      // Asignar eventos a los nuevos botones
      document.querySelectorAll(".btn-aplicar").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const id = e.currentTarget.getAttribute("data-id");
          const titulo = e.currentTarget.getAttribute("data-titulo");
          abrirModal(id, titulo);
        });
      });
    } catch (err) {
      console.error(err);
      contenedorVacantes.innerHTML = `<p class="text-red-500 font-black text-center col-span-full uppercase text-xs tracking-widest">Ocurrió un error al cargar las posiciones.</p>`;
    }
  }

  // 4. Lógica de Envío del Formulario (Conexión Real con FormData)
  formAplicacion.addEventListener("submit", async (e) => {
    e.preventDefault();

    const originalBtnText = btnEnviarAplicacion.innerHTML;
    btnEnviarAplicacion.innerHTML =
      '<i class="fa-solid fa-circle-notch fa-spin"></i> Analizando perfil con IA...';
    btnEnviarAplicacion.disabled = true;

    try {
      // FormData es necesario para enviar archivos físicos
      const formData = new FormData();
      formData.append(
        "id_vacante",
        document.getElementById("c-id-vacante").value,
      );
      formData.append("nombre", document.getElementById("c-nombre").value);
      formData.append("correo", document.getElementById("c-correo").value);
      formData.append("telefono", document.getElementById("c-telefono").value);
      formData.append("linkedin", document.getElementById("c-linkedin").value);

      // Adjuntamos el archivo PDF
      const archivoInput = document.getElementById("c-archivo-cv");
      formData.append("archivo_cv", archivoInput.files[0]);

      // Petición al Backend
      const respuesta = await fetch(`${CONFIG.API_URL}/public/aplicar`, {
        method: "POST",
        body: formData, // Nota: Cuando usas FormData, NO se pone el header 'Content-Type'
      });

      const data = await respuesta.json();

      // ... (código donde procesas el fetch)

      if (!respuesta.ok || !data.exito) {
        if (respuesta.status === 409) {
          NotificationService.warning(
            "Ya tienes una postulación activa",
            data.error || "Ya registramos una postulación con este correo para esta vacante. No es necesario volver a enviar tu currículum.",
            7000,
          );
        } else {
          NotificationService.apiError(
            respuesta,
            data,
            "No se pudo procesar tu postulación.",
          );
        }
        return;
      }

      cerrarModal();
      setTimeout(() => {
        abrirModalExito();
      }, 300);
    } catch (err) {
      console.error("Error al enviar la postulación:", err);
      NotificationService.error(
        "No pudimos enviar tu postulación",
        "Verifica tu conexión e intenta nuevamente. Si el problema continúa, inténtalo más tarde.",
      );
    } finally {
      btnEnviarAplicacion.innerHTML = originalBtnText;
      btnEnviarAplicacion.disabled = false;
    }
  });

  // Ejecutar
  cargarVacantesPublicas();
});
