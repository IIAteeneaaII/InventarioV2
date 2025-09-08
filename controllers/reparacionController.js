const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logService = require('../services/logService');
const modemService = require('../services/modemService');

/**
 * Listar todos los modems en fase de reparación
 */
exports.listarModemsEnReparacion = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRol = req.user.rol;
    
    // Roles permitidos para ver modems en reparación
    const rolesPermitidos = ['URep', 'UTI', 'UA'];
    
    if (!rolesPermitidos.includes(userRol)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para ver modems en reparación'
      });
    }
    
    // Consultar modems en fase de reparación
    const modems = await prisma.modem.findMany({
      where: {
        faseActual: 'REPARACION',
        deletedAt: null
      },
      include: {
        sku: {
          select: {
            nombre: true,
            skuItem: true
          }
        },
        estadoActual: true,
        registros: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          include: {
            codigoReparacion: true,
            codigoDano: true
          },
          select: {
            reparacion: true,
            createdAt: true,
            codigoReparacion: true,
            codigoDano: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    return res.status(200).json({
      success: true,
      data: modems
    });
  } catch (error) {
    console.error('Error al listar modems en reparación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Registrar un diagnóstico de reparación con código de daño
 */
exports.registrarDiagnostico = async (req, res) => {
  try {
    const { sn, codigoDano, diagnostico } = req.body;
    const userId = req.user.id;
    const userRol = req.user.rol;
    
    // Roles permitidos para diagnóstico
    const rolesPermitidos = ['URep', 'UTI', 'UA'];
    
    if (!rolesPermitidos.includes(userRol)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para registrar diagnósticos'
      });
    }
    
    if (!sn || !codigoDano) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere número de serie y código de daño'
      });
    }
    
    // Buscar el modem
    const modem = await modemService.buscarPorSN(sn);
    
    if (!modem) {
      return res.status(404).json({
        success: false,
        message: 'Modem no encontrado'
      });
    }
    
    if (modem.faseActual !== 'REPARACION') {
      return res.status(400).json({
        success: false,
        message: `El modem debe estar en fase REPARACION. Fase actual: ${modem.faseActual}`
      });
    }
    
    // Buscar el código de daño
    const codigoDanoObj = await prisma.codigoDano.findFirst({
      where: { codigo: codigoDano },
      include: { codigoRep: true }
    });
    
    if (!codigoDanoObj) {
      return res.status(404).json({
        success: false,
        message: 'Código de daño no válido'
      });
    }
    
    // Crear un nuevo registro con el diagnóstico y códigos
    await prisma.registro.create({
      data: {
        sn: modem.sn,
        fase: 'REPARACION',
        estado: 'REPARACION',
        reparacion: diagnostico || `Código de daño: ${codigoDano}`,
        codigoDanoId: codigoDanoObj.id,
        codigoReparacionId: codigoDanoObj.codigoRepId,
        userId,
        loteId: modem.loteId,
        modemId: modem.id
      }
    });
    
    // Registrar en log
    await logService.registrarAccion({
      accion: 'DIAGNOSTICO_REPARACION',
      entidad: 'Modem',
      detalle: `SN: ${modem.sn}, Código: ${codigoDano}, Reparación: ${codigoDanoObj.codigoRep?.descripcion || 'N/A'}`,
      userId
    });
    
    return res.status(200).json({
      success: true,
      message: 'Diagnóstico registrado exitosamente',
      data: {
        codigoDano: codigoDanoObj,
        reparacionSugerida: codigoDanoObj.codigoRep?.descripcion
      }
    });
  } catch (error) {
    console.error('Error al registrar diagnóstico:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Completar reparación y avanzar a la siguiente fase
 */
exports.completarReparacion = async (req, res) => {
  try {
    const { sn, faseDestino, comentario } = req.body;
    const userId = req.user.id;
    const userRol = req.user.rol;
    
    // Roles permitidos para completar reparaciones
    const rolesPermitidos = ['URep', 'UTI', 'UA'];
    
    if (!rolesPermitidos.includes(userRol)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para completar reparaciones'
      });
    }
    
    if (!sn || !faseDestino) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere número de serie y fase destino'
      });
    }
    
    // Fases válidas para mover después de reparación
    const fasesPermitidas = ['TEST_INICIAL', 'ENSAMBLE', 'RETEST', 'SCRAP'];
    
    if (!fasesPermitidas.includes(faseDestino)) {
      return res.status(400).json({
        success: false,
        message: `La fase destino debe ser una de: ${fasesPermitidas.join(', ')}`
      });
    }
    
    // Buscar el modem
    const modem = await modemService.buscarPorSN(sn);
    
    if (!modem) {
      return res.status(404).json({
        success: false,
        message: 'Modem no encontrado'
      });
    }
    
    if (modem.faseActual !== 'REPARACION') {
      return res.status(400).json({
        success: false,
        message: `El modem debe estar en fase REPARACION. Fase actual: ${modem.faseActual}`
      });
    }
    
    // Buscar el estado correspondiente a la fase destino
    const estadoDestino = await prisma.estado.findFirst({
      where: { nombre: faseDestino }
    });
    
    if (!estadoDestino) {
      return res.status(500).json({
        success: false,
        message: `Error: No se encontró el estado ${faseDestino}`
      });
    }
    
    // Actualizar el modem
    const modemActualizado = await prisma.modem.update({
      where: { id: modem.id },
      data: {
        estadoActualId: estadoDestino.id,
        faseActual: faseDestino,
        responsableId: userId
      }
    });
    
    // Determinar el estado de registro según la fase destino
    let estadoRegistro = 'SN_OK';
    if (faseDestino === 'SCRAP') {
      estadoRegistro = 'SCRAP_ELECTRONICO';
    }
    
    // Crear registro de la acción
    await prisma.registro.create({
      data: {
        sn: modem.sn,
        fase: faseDestino,
        estado: estadoRegistro,
        reparacion: comentario || 'Reparación completada',
        userId,
        loteId: modem.loteId,
        modemId: modem.id
      }
    });
    
    // Registrar en log
    await logService.registrarAccion({
      accion: `COMPLETAR_REPARACION_A_${faseDestino}`,
      entidad: 'Modem',
      detalle: `SN: ${modem.sn}, Fase destino: ${faseDestino}, Comentario: ${comentario || 'No proporcionado'}`,
      userId
    });
    
    return res.status(200).json({
      success: true,
      message: `Reparación completada. Modem avanzado a fase ${faseDestino}`,
      data: {
        modem: modemActualizado
      }
    });
  } catch (error) {
    console.error('Error al completar reparación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtener historial de reparaciones de un modem
 */
exports.obtenerHistorialReparaciones = async (req, res) => {
  try {
    const { sn } = req.params;
    
    if (!sn) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere número de serie'
      });
    }
    
    // Buscar el modem
    const modem = await modemService.buscarPorSN(sn);
    
    if (!modem) {
      return res.status(404).json({
        success: false,
        message: 'Modem no encontrado'
      });
    }
    
    // Obtener todos los registros de reparación para este modem
    const historial = await prisma.registro.findMany({
      where: {
        modemId: modem.id,
        fase: 'REPARACION',
        reparacion: { not: null }
      },
      include: {
        user: {
          select: {
            nombre: true,
            userName: true
          }
        },
        codigoReparacion: true,
        codigoDano: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    return res.status(200).json({
      success: true,
      data: {
        modem: {
          sn: modem.sn,
          sku: modem.sku.nombre,
          faseActual: modem.faseActual
        },
        historial
      }
    });
  } catch (error) {
    console.error('Error al obtener historial de reparaciones:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtener todos los códigos de daño disponibles
 */
exports.obtenerCodigosDano = async (req, res) => {
  try {
    const codigos = await prisma.codigoDano.findMany({
      include: { codigoRep: true },
      orderBy: { codigo: 'asc' }
    });
    
    return res.status(200).json({
      success: true,
      data: codigos
    });
  } catch (error) {
    console.error('Error al obtener códigos de daño:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtener todos los códigos de reparación disponibles
 */
exports.obtenerCodigosReparacion = async (req, res) => {
  try {
    const codigos = await prisma.codigoReparacion.findMany({
      orderBy: { codigo: 'asc' }
    });
    
    return res.status(200).json({
      success: true,
      data: codigos
    });
  } catch (error) {
    console.error('Error al obtener códigos de reparación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};