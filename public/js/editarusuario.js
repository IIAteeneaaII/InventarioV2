document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('formEditarUsuario');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('usuarioId').value;
    const nombre = document.getElementById('nombre').value;
    const userName = document.getElementById('userName').value;
    const email = document.getElementById('email').value;
    const rol = document.getElementById('rol').value;

    try {
      const res = await fetch(`/actualizarusuario/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, userName, email, rol })
      });

      if (res.ok) {
        await Swal.fire({
          icon: 'success',
          title: '¡Usuario editado correctamente!',
          confirmButtonText: 'Aceptar',
          timer: 1800
        });
        window.location.href = '/adminusuarios'; // cambia esto si tu dashboard tiene otra ruta
      } else {
        const error = await res.json();
        throw new Error(error.error || 'Error al actualizar');
      }
    } catch (error) {
      console.error('Error:', error.message);
      Swal.fire({
        icon: 'error',
        title: 'Error al editar usuario',
        text: error.message || 'Ocurrió un error inesperado'
      });
    }
  });
});
