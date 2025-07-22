const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const userRepo = require('../repositories/userRepositoryPrisma');
const { setFlashMessage } = require('../utils/flashMessage');
const redis = require('../redisClient');
const { sendRecoveryEmail } = require('../emailSender');
const { createOrUpdateJob } = require('../utils/jobManager');
const {
  createResetCode,
  findValidResetCode,
  deleteResetCodeById,
  saveMood,
  findMoodByUserAndDate,
  getMoodsByUser
} = userRepo;

// LOGIN
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        userName: user.userName,
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
    const rolesSeleccionLote = ['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL'];
    switch (user.rol) {
      case 'UAI':
        return res.json({ redirectTo: '/adminventario' });
      case 'UReg':
        return res.json({ redirectTo: '/registro' });
      default:
        if (rolesSeleccionLote.includes(user.rol)) {
          return res.json({ redirectTo: '/seleccionlote' });
        } else {
          return res.status(403).json({ error: 'Rol no autorizado' });
        }
    }

  } catch (err) {
    console.error(err);
    setFlashMessage(res, 'Hubo un error en el servidor. Intenta más tarde', 'error');
    res.redirect('/');
  }
};

// REGISTRO (público, solo si corresponde)
exports.registrar = async (req, res) => {
  const { email, password, userName, nombre, rol } = req.body;
  try {
    const exists = await userRepo.findByEmail(email);
    if (exists) {
      setFlashMessage(res, 'El usuario ya existe', 'error');
      return res.redirect('/registro_prueba');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await userRepo.createUser({
      email,
      password: hashedPassword,
      userName,
      nombre,
      rol
    });

    // Programa tareas del usuario recién creado
    createOrUpdateJob(user.id, 'morning', 8);
    createOrUpdateJob(user.id, 'afternoon', 13);
    createOrUpdateJob(user.id, 'night', 21);

    setFlashMessage(res, '¡Registro exitoso! Ya puedes iniciar sesión.', 'success');
    res.redirect('/');
  } catch (err) {
    console.error(err);
    setFlashMessage(res, 'Hubo un error en el servidor. Intenta más tarde', 'error');
    res.redirect('/registro_prueba');
  }
};

// ELIMINAR CUENTA
exports.deleteAccount = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await userRepo.findByEmail(email);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ msg: 'Invalid credentials' });

    await userRepo.deleteUserByEmail(email);
    res.clearCookie('token', {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict'
    });

    res.status(200).json({ msg: 'Account deleted successfully and cookie cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// RECUPERAR CONTRASEÑA (enviar código)
exports.recoverPassword = async (req, res) => {
  const { email } = req.body;

  const user = await userRepo.findByEmail(email);
  if (!user) return res.status(404).json({ message: 'Email not found' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await createResetCode(email, code);
  await sendRecoveryEmail(email, code);

  res.status(200).json({ message: 'Verification code sent to your email' });
};

// VALIDAR TOKEN/CÓDIGO DE RECUPERACIÓN (opcional, para frontend)
exports.validateResetToken = async (req, res) => {
  const { token } = req.query;

  const email = await redis.get(`reset-token:${token}`);
  if (!email) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }

  res.status(200).json({ message: 'Token is valid', email });
};

// RESETEAR CONTRASEÑA
exports.resetPassword = async (req, res) => {
  const { code, newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  const codeEntry = await findValidResetCode(code);
  if (!codeEntry) {
    return res.status(400).json({ message: 'Invalid or expired code' });
  }

  const user = await userRepo.findByEmail(codeEntry.email);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await userRepo.updatePassword(user.email, hashedPassword);

  await deleteResetCodeById(codeEntry.id);

  res.status(200).json({ message: 'Password updated successfully' });
};

// LOGOUT (mejorado: redirige)
exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
};

// --- MIDDLEWARES DE AUTENTICACIÓN Y ROLES ---
exports.verificarAuth = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).redirect('/');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).redirect('/');
  }
};

exports.verificarRol = (rolesEsperados) => {
  return (req, res, next) => {
    const user = req.user;
    const roles = Array.isArray(rolesEsperados) ? rolesEsperados : [rolesEsperados];
    if (!user || !roles.includes(user.rol)) {
      return res.status(403).send('Acceso denegado');
    }
    next();
  };
};

// Placeholder para actualizar perfil (opcional)
exports.updateProfile = (req, res) => {
  res.json({ msg: 'Perfil actualizado correctamente (pendiente de implementación)' });
};
