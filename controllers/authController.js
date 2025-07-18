const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const userRepo = require('../repositories/userRepositoryPrisma');

// Login
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await userRepo.findByEmail(email);
    if (!user) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    const token = jwt.sign(
      { id: user.id, email: user.email, userName: user.userName, rol: user.rol },
      process.env.JWT_SECRET || 'supersecret',
      { expiresIn: '1h' }
    );
    res.cookie('token', token, { httpOnly: true, secure: false, maxAge: 60 * 60 * 1000 });
    res.json({ message: 'Inicio de sesión exitoso', redirectTo: '/dashboard' }); // Ajusta redirect según rol
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hubo un error en el servidor.' });
  }
};

// Registro público (opcional, elimina si solo hay registro admin)
exports.registrar = async (req, res) => {
  const { email, password, userName, nombre, rol, activo = true } = req.body;
  try {
    const exists = await userRepo.findByEmail(email);
    if (exists) return res.status(400).json({ error: 'El usuario ya existe' });
    const hashedPassword = await bcrypt.hash(password, 10);
    await userRepo.createUser({
      email,
      password: hashedPassword,
      userName,
      nombre,
      rol,
      activo
    });
    res.status(200).json({ message: '¡Registro exitoso! Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error interno del servidor al registrar.' });
  }
};

// Logout
exports.logout = (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Sesión cerrada correctamente.' });
};

// Recuperar contraseña (simplificado)
exports.recoverPassword = async (req, res) => { /* tu lógica aquí */ };
exports.resetPassword = async (req, res) => { /* tu lógica aquí */ };

// Middleware protección JWT
exports.verificarAuth = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

// Middleware de roles
exports.verificarRol = (rolesEsperados) => {
  return (req, res, next) => {
    const user = req.user;
    const roles = Array.isArray(rolesEsperados) ? rolesEsperados : [rolesEsperados];
    if (!user || !roles.includes(user.rol)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
  };
};
