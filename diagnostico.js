const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Crear una pequeña aplicación express para diagnóstico
const app = express();
app.use(cookieParser());

// Ruta de diagnóstico
app.get('/', (req, res) => {
  console.log('[DIAGNOSTICO] Cookies:', req.cookies);
  // Decodificar token si está presente
  const token = req.cookies?.token;
  let usuario = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
      console.log('[DIAGNOSTICO] Token decodificado:', decoded);
      usuario = decoded;
    } catch (err) {
      console.log('[DIAGNOSTICO] Error al decodificar token:', err.message);
    }
  }
  res.send(`
    <h1>Página de diagnóstico SIMOD</h1>
    <p>Esta es una página para diagnosticar problemas de autenticación.</p>
    <h2>Información del token</h2>
    <pre>${token ? 'Token presente' : 'No hay token'}</pre>
    <h2>Información del usuario</h2>
    <pre>${usuario ? JSON.stringify(usuario, null, 2) : 'No hay usuario autenticado'}</pre>
    <p><a href="http://localhost:3000/">Volver a SIMOD</a></p>
  `);
});

// Puerto diferente para evitar conflictos
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Herramienta de diagnóstico ejecutándose en http://localhost:${PORT}`);
});
