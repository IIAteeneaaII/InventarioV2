const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const userRepo = require('../repositories/userRepositoryPrisma');

// Crear un usuario (solo admin)
exports.register = async (req, res) => {
  const { email, password, userName, nombre, rol, activo = true } = req.body;
  if (!email || !password || !userName || !nombre || !rol) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }
  try {
    const exists = await userRepo.findByEmail(email);
    if (exists) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await userRepo.createUser({
      email,
      password: hashedPassword,
      userName,
      nombre,
      rol,
      activo
    });
    await prisma.log.create({
      data: {
        usuarioId: req.user.id,
        accion: 'crear',
        entidad: 'Usuario',
        detalle: `Creó usuario ${email}`
      }
    });
    return res.status(201).json({
      success: true,
      message: '¡Registro exitoso! Ya puedes iniciar sesión.',
      user: {
        id: user.id,
        nombre: user.nombre,
        userName: user.userName,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error('Error crearUsuario:', error);
    res.status(500).json({ success: false, message: 'Error al crear usuario' });
  }
};


// Listar usuarios
exports.listarUsuarios = async (req, res) => {
  try {
    const usuarios = await prisma.user.findMany({
      where: { deletedAt: null, activo: true }, // Solo usuarios activos y no eliminados
      select: { id: true, nombre: true, userName: true, email: true, rol: true }
    });
    res.render('admin_dashboard', { usuarios });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).send('Error al cargar la vista de usuarios');
  }
};

// Actualizar usuario
exports.actualizarUsuario = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, email, rol, activo } = req.body;
    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    const usuarioExistente = await prisma.user.findUnique({ where: { id } });
    if (!usuarioExistente) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    // Valida email único
    const emailEnUso = await prisma.user.findFirst({
      where: { email, NOT: { id } }
    });
    if (emailEnUso) {
      return res.status(409).json({ error: 'El email ya está registrado por otro usuario' });
    }
    const usuarioActualizado = await prisma.user.update({
      where: { id },
      data: { nombre, email, rol, activo }
    });
    await prisma.log.create({
      data: {
        usuarioId: req.user.id,
        accion: 'editar',
        entidad: 'Usuario',
        detalle: `Actualizó usuario ID ${id}`
      }
    });
    res.json({
      id: usuarioActualizado.id,
      nombre: usuarioActualizado.nombre,
      email: usuarioActualizado.email,
      rol: usuarioActualizado.rol,
      activo: usuarioActualizado.activo
    });
  } catch (error) {
    console.error('Error actualizarUsuario:', error);
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
};

// Eliminar usuario (hard delete)
exports.eliminarUsuario = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const usuarioExistente = await prisma.user.findUnique({ where: { id } });
    if (!usuarioExistente) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    const usuarioEliminado = await prisma.user.delete({ where: { id } });
    await prisma.log.create({
      data: {
        usuarioId: req.user.id,
        accion: 'eliminar',
        entidad: 'Usuario',
        detalle: `Eliminó usuario ID ${id}`
      }
    });
    res.json({ mensaje: 'Usuario eliminado correctamente', usuario: { id: usuarioEliminado.id, email: usuarioEliminado.email } });
  } catch (error) {
    console.error('Error eliminarUsuario:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
};

// Soft delete
exports.eliminarUsuarioSoft = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() }
    });
    res.status(200).json({ message: 'Cuenta eliminada (soft delete) correctamente' });
  } catch (error) {
    console.error("Error al eliminar usuario (soft delete):", error);
    res.status(500).json({ message: 'Error interno al eliminar usuario' });
  }
};

// Activar/desactivar usuario
exports.toggleEstadoUsuario = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const usuario = await prisma.user.findUnique({ where: { id: userId } });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    const nuevoEstado = !usuario.activo;
    await prisma.user.update({
      where: { id: userId },
      data: { activo: nuevoEstado }
    });
    await prisma.log.create({
      data: {
        usuarioId: req.user.id,
        accion: nuevoEstado ? 'habilitar' : 'deshabilitar',
        entidad: 'Usuario',
        detalle: `${nuevoEstado ? 'Habilitó' : 'Deshabilitó'} usuario ID ${userId}`
      }
    });
    res.json({ mensaje: `Usuario ${nuevoEstado ? 'habilitado' : 'deshabilitado'} correctamente`, activo: nuevoEstado });
  } catch (error) {
    console.error('Error al alternar estado del usuario:', error);
    res.status(500).json({ error: 'Error interno al cambiar estado del usuario' });
  }
};

// Ver logs
exports.verLogs = async (req, res) => {
  try {
    const logs = await prisma.log.findMany({
      include: { usuario: { select: { id: true, nombre: true, email: true } } },
      orderBy: { timestamp: 'desc' }
    });
    res.json(logs);
  } catch (error) {
    console.error('Error verLogs:', error);
    res.status(500).json({ error: 'Error al obtener logs' });
  }
};

// Vista para editar usuario (si usas EJS)
exports.vistaEditarUsuario = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const usuario = await prisma.user.findUnique({ where: { id } });
    if (!usuario) return res.status(404).render('404', { mensaje: 'Usuario no encontrado' });
    res.render('editarusuario', { usuario });
  } catch (error) {
    console.error('Error al cargar vista de edición:', error);
    res.status(500).render('error', { mensaje: 'Error interno del servidor' });
  }
};
