// TalentAI: interacciones de navegación y presentación comercial.
// No se envían ni almacenan datos comerciales en esta versión.
(() => {
  "use strict";
  // Configuración opcional para el futuro. No inventar ni exponer un correo comercial.
  // Cuando exista un buzón verificado, puedes indicarlo aquí para habilitar "Enviar por correo".
  const COMMERCIAL_EMAIL = "";

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("nav-toggle");
    const menu = document.getElementById("mobile-nav");
    const closeMobileMenu = () => {
      if (!toggle || !menu) return;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menú");
      menu.hidden = true;
    };
    toggle?.addEventListener("click", () => {
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.setAttribute("aria-label", opening ? "Cerrar menú" : "Abrir menú");
      menu.hidden = !opening;
    });
    menu?.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMobileMenu));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMobileMenu();
    });

    // Vista previa de oportunidades reales; la postulación solo se realiza en careers.html.
    const featuredContainer = document.getElementById("oportunidades-destacadas");
    async function cargarDestacadas() {
      if (!featuredContainer) return;
      featuredContainer.replaceChildren();
      const loading = document.createElement("div");
      loading.className = "vacancy-placeholder";
      loading.textContent = "Consultando oportunidades...";
      featuredContainer.appendChild(loading);
      try {
        const vacantes = (await PublicVacanciesAPI.cargarVacantes())
          .filter(v => v.estado === "Activa" || v.estado === "Abierta")
          .slice(0, 3);
        if (!vacantes.length) {
          loading.textContent = "No hay vacantes abiertas en este momento. Puedes consultar el portal de empleos más adelante.";
          return;
        }
        featuredContainer.replaceChildren();
        for (const vacancy of vacantes) {
          const card = document.createElement("article");
          card.className = "featured-opportunity";
          const department = document.createElement("span");
          department.className = "eyebrow";
          department.textContent = vacancy.departamentos?.nombre || "Área no especificada";
          const title = document.createElement("h4");
          title.textContent = vacancy.titulo || "Vacante";
          const description = document.createElement("p");
          description.textContent = vacancy.descripcion_puesto || "Consulta los requisitos en el portal de empleo.";
          const link = document.createElement("a");
          link.href = "careers.html#vacantes";
          link.textContent = "Ver oportunidad en portal de empleo ";
          const icon = document.createElement("i");
          icon.className = "fa-solid fa-arrow-right";
          link.appendChild(icon);
          card.append(department, title, description, link);
          featuredContainer.appendChild(card);
        }
      } catch (error) {
        console.error("Error en oportunidades destacadas:", { api: PublicVacanciesAPI.apiBaseURL(), error });
        featuredContainer.replaceChildren();
        const box = document.createElement("div");
        box.className = "vacancy-placeholder";
        const message = document.createElement("p");
        message.textContent = PublicVacanciesAPI.friendlyMessage(error);
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "vacancy-retry";
        retry.textContent = "Reintentar carga";
        retry.addEventListener("click", cargarDestacadas);
        box.append(message, retry);
        featuredContainer.appendChild(box);
      }
    }
    cargarDestacadas();

    const form = document.getElementById("form-interes");
    const prepared = document.getElementById("solicitud-preparada");
    const textArea = document.getElementById("solicitud-texto");
    const copyButton = document.getElementById("btn-copiar-solicitud");
    const copyStatus = document.getElementById("copiar-estado");
    const emailLink = document.getElementById("enviar-correo-comercial");

    if (!form || !prepared || !textArea) return;

    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const nombre = document.getElementById("interes-nombre").value.trim();
      const empresa = document.getElementById("interes-organizacion").value.trim();
      const tema = document.getElementById("interes-tema").value;
      if (!nombre || !empresa) return;

      const asunto = `Interés en TalentAI - ${empresa}`;
      const mensaje = [
        "Hola, equipo TalentAI:", "",
        `Mi nombre es ${nombre} y represento a ${empresa}.`,
        `Me interesa conocer más sobre: ${tema}.`, "",
        "Quisiera recibir información cuando estén disponibles las demostraciones y opciones comerciales.", "",
        "Saludos,", nombre,
      ].join("\n");
      textArea.value = mensaje;
      prepared.hidden = false;
      if (copyStatus) copyStatus.textContent = "El mensaje se generó en tu navegador y no se ha enviado.";

      // El envío por correo solo se muestra si existe una dirección configurada explícitamente.
      if (emailLink && COMMERCIAL_EMAIL) {
        emailLink.href = `mailto:${encodeURIComponent(COMMERCIAL_EMAIL)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
        emailLink.hidden = false;
      } else if (emailLink) {
        emailLink.hidden = true;
        emailLink.removeAttribute("href");
      }
      prepared.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    copyButton?.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API no disponible");
        await navigator.clipboard.writeText(textArea.value);
        if (copyStatus) copyStatus.textContent = "Mensaje copiado. Puedes compartirlo por el canal que prefieras.";
      } catch (_) {
        textArea.focus();
        textArea.select();
        if (copyStatus) copyStatus.textContent = "Seleccionamos el mensaje; cópialo con ⌘+C o Ctrl+C.";
      }
    });
  });
})();
