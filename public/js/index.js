document.addEventListener("DOMContentLoaded", () => {
  const validator = new JustValidate('#formLogin');

  validator
    .addField('#correo', [
      {
        rule: 'required',
        errorMessage: 'El correo es obligatorio',
      },
      {
        rule: 'email',
        errorMessage: 'Ingresa un correo válido',
      },
    ])
    .addField('#contrasena', [
      {
        rule: 'required',
        errorMessage: 'La contraseña es obligatori',
      },
      {
        rule: 'minLength',
        value: 8,
        errorMessage: 'Debe tener al menos 8 caracteres',
      },
      {
        rule: 'customRegexp',
        value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
        errorMessage: 'Debe contener al menos una mayúscula, una minúscula y un número',
      },
    ])
    .onSuccess((event) => {
      event.preventDefault();
      loginUser();
    });

  async function loginUser() {
    const form = document.getElementById('formLogin');
    const formData = new FormData(form);
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });

      const data = await response.json();
      
    if (response.ok && data.redirectTo) {
      window.location.href = data.redirectTo;
    } else {
      throw new Error(data.message || 'Error en el inicio de sesión');
    }

      // Guardar token en localStorage
      localStorage.setItem('token', data.token);
      localStorage.setItem('usuario', JSON.stringify(data.usuario));

      // Redirigir según el rol
      switch(data.usuario.rol) {
        case 'UAI':
          window.location.href = '/adminventario';
          break;
        case 'UA':
          window.location.href = '/almacen';
          break;
        case 'UV':
          window.location.href = '/visualizacion';
          break;
        case 'UReg':
          window.location.href = '/registro';
          break;
        case 'UTI':
          window.location.href = '/testini';
          break;
        case 'UR':
          window.location.href = '/retest';
          break;
        case 'UC':
          window.location.href = '/cosmetica';
          break;
        case 'UE':
          window.location.href = '/empaque';
          break;
        case 'ULL':
          window.location.href = '/lineaLote';
          break;
        default:
          window.location.href = '/dashboard';
      }
      
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message
      });
    }
  }
});