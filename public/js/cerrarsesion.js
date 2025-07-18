// cerrarSesion.js

function cerrarSesion() {
  Swal.fire({
    title: "¿Deseas cerrar sesión?",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Sí, salir",
    cancelButtonText: "Cancelar"
  }).then((result) => {
    if (result.isConfirmed) {
      // 1. Elimina todas las cookies
      document.cookie.split(";").forEach((cookie) => {
        const name = cookie.split("=")[0].trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });

      // 2. Elimina token del localStorage
      localStorage.removeItem("token");

      // 3. Marca que se mostró el logout (opcional)
      localStorage.setItem("showLogoutModal", "1");

      // 4. Redirige al inicio
      window.location.href = "/";
    }
  });
}

// Espera a que cargue el DOM y agrega el evento a todos los elementos con clase "logout-icon"
document.addEventListener("DOMContentLoaded", () => {
  const logoutButtons = document.querySelectorAll(".logout-icon");
  logoutButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault(); // Por si alguno es <a>
      cerrarSesion();
    });
  });
});
