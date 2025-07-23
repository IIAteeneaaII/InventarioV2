const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

// IMPORTACIONES FALTANTES - AÑADIDAS
const userRepo = require('../repositories/userRepositoryPrisma');
const { setFlashMessage } = require('../utils/flashMessage');
const redis = require('../redisClient');
const { sendRecoveryEmail } = require('../emailSender');
const { createOrUpdateJob } = require('../utils/jobManager');

// Destrucutrando funciones del repositorio si las necesitas
const {
  createResetCode,
  findValidResetCode,
  deleteResetCodeById,
  saveMood,
  findMoodByUserAndDate,
  getMoodsByUser
} = userRepo;

// LOGIN - Versión robusta y con logs
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      setFlashMessage(res, 'Correo o contraseña incorrectos', 'error');
      return res.redirect('/');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      setFlashMessage(res, 'Correo o contraseña incorrectos', 'error');
      return res.redirect('/');
    }

    // CAMBIO IMPORTANTE: Incluir nombre en el token JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        userName: user.userName,
        nombre: user.nombre, // Añadido nombre
        rol: user.rol
      },
      process.env.JWT_SECRET || 'supersecret',
      { expiresIn: '1h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 1000,
    });

    setFlashMessage(res, '¡Inicio de sesión éxitoso.', 'success');
    
    // Redirección según rol
    const rolesSeleccionLote = ['UA', 'UV', 'UReg', 'UTI', 'UR', 'UC', 'UE', 'ULL'];
    let redirectTo;
    switch (user.rol) {
      case 'UAI':
        redirectTo = '/adminventario';
        break;
      case 'UReg':
        redirectTo = '/seleccionlote';
        break;
      default:
        if (rolesSeleccionLote.includes(user.rol)) {
          redirectTo = '/seleccionlote'; // Sin guión, como está en viewRoutes
        } else {
          return res.status(403).json({ 
            error: 'Rol no autorizado',
            user: null 
          });
        }
    }

    // Devolver datos de usuario junto con redirectTo
    return res.status(200).json({
      redirectTo: redirectTo,
      user: {
        id: user.id,
        email: user.email,
        userName: user.userName,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (err) {
    console.error(err);
    setFlashMessage(res, 'Hubo un error en el servidor. Intenta más tarde', 'error');
    return res.status(500).json({ error: 'Error del servidor' });
  }
};

// Implementaciones de los otros métodos (usa los existentes)
exports.registrar = async (req, res) => { /* Tu implementación existente */ };
exports.logout = (req, res) => { /* Tu implementación existente */ };
exports.recoverPassword = async (req, res) => { /* Tu implementación existente */ };
exports.resetPassword = async (req, res) => { /* Tu implementación existente */ };

// VERIFICACIÓN DE AUTENTICACIÓN - Versión mejorada con más logs
exports.verificarAuth = (req, res, next) => {
  console.log('[VERIFICAR AUTH] Iniciando verificación de autenticación');
  // 1. Verificar si existe token en las cookies
  const token = req.cookies?.token;
  console.log('[VERIFICAR AUTH] ¿Token presente?:', !!token);
  if (!token) {
    console.log('[VERIFICAR AUTH] No hay token, redirigiendo a login');
    return res.status(401).redirect('/');
  }
  try {
    // 2. Decodificar y verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    console.log('[VERIFICAR AUTH] Token válido para:', decoded.userName);
    // 3. Añadir información del usuario a la solicitud
    req.user = {
      id: decoded.id,
      email: decoded.email,
      userName: decoded.userName,
      nombre: decoded.nombre || decoded.userName,
      rol: decoded.rol
    };
    console.log('[VERIFICAR AUTH] Usuario autenticado:', req.user.userName, '('+req.user.rol+')');
    next();
  } catch (err) {
    console.error('[VERIFICAR AUTH] Error al verificar token:', err.message);
    // 4. Eliminar token inválido y redirigir
    res.clearCookie('token');
    return res.status(401).redirect('/?error=sesion_expirada');
  }
};

// VERIFICACIÓN DE ROL - Versión mejorada con más logs
exports.verificarRol = (roles) => (req, res, next) => {
  console.log(`[VERIFICAR ROL] Usuario: ${req.user?.userName}, Rol: ${req.user?.rol}, Roles permitidos: ${roles.join(', ')}`);
  if (!req.user) {
    console.log('[VERIFICAR ROL] No hay usuario en la solicitud');
    return res.status(401).redirect('/');
  }
  if (Array.isArray(roles) && roles.includes(req.user.rol)) {
    console.log(`[VERIFICAR ROL] Acceso permitido para ${req.user.userName} con rol ${req.user.rol}`);
    next();
  } else {
    console.log(`[VERIFICAR ROL] Acceso denegado para ${req.user.userName} con rol ${req.user.rol}`);
    return res.status(403).redirect('/');
  }
};

// CORRECCIÓN: Eliminar verificación de validateLogin que no pertenece a este archivo
console.log('login:', typeof exports.login);
console.log('registrar:', typeof exports.registrar);