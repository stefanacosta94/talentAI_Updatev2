// ==========================================
// js/auth.js
// Controlador de la pantalla de Login
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  // 1. Protección de ruta: Si ya está logueado, lo mandamos directo al dashboard
  if (AuthService.estaAutenticado()) {
    window.location.href = "dashboard.html";
    return;
  }

  const formLogin = document.getElementById("form-login");
  const errorLogin = document.getElementById("error-login");
  const btnSubmit = document.getElementById("btn-submit");

  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();

    console.log("¡El botón fue presionado y JavaScript lo detectó!"); // 👈 AGREGA ESTO

    // Limpiamos errores previos
    errorLogin.classList.add("hidden");

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    // Feedback visual de carga
    const originalBtnText = btnSubmit.innerHTML;
    btnSubmit.innerHTML =
      '<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...';
    btnSubmit.disabled = true;

    try {
      const respuesta = await fetch(`${CONFIG.API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await respuesta.json();

      if (!respuesta.ok || !data.exito) {
        throw new Error(data.error || "Credenciales incorrectas");
      }

      // Guardamos la sesión usando nuestra herramienta centralizada
      AuthService.iniciarSesion(data.token, data.usuario);

      // Redirección a la nueva página física del módulo administrativo
      window.location.href = "dashboard.html";
    } catch (err) {
      errorLogin.innerText = err.message;
      errorLogin.classList.remove("hidden");
      btnSubmit.innerHTML = originalBtnText;
      btnSubmit.disabled = false;
    }
  });
});
