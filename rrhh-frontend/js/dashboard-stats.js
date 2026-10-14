// Inject stats logic
document.addEventListener("DOMContentLoaded", async () => {
  if (!AuthService.estaAutenticado()) return;
  const token = AuthService.obtenerToken();
  try {
    const res = await fetch(`${CONFIG.API_URL}/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { data } = await res.json();
    if (res.ok && data?.stats) {
      document.getElementById("contador-vacantes").innerText = data.stats.total_vacantes || 0;
      document.getElementById("contador-aplicaciones").innerText = data.stats.total_aplicaciones || 0;
      document.getElementById("contador-empleados").innerText = data.stats.total_empleados || 0;
      // also update score if there's a place for it
    }
  } catch(e) {}
});
