const {
  PrismaClient,
  FaseProceso,
  EstadoLote,
  TipoLote,
  EstadoRegistro,
  MotivoScrap,
  DetalleScrap
} = require('@prisma/client');
const prisma = new PrismaClient();
const modemService = require('../services/modemService');
const { v4: uuidv4 } = require('uuid');

/**
 * Mapea un rol de usuario a una fase del proceso y carpeta de formato.
 */
const getRolConfig = (rol) => {
  const configs = {
    UReg: { fase: FaseProceso.REGISTRO, carpeta: 'formato_registro' },
    UE: { fase: FaseProceso.EMPAQUE, carpeta: 'formato_empaque' },
    UEN: { fase: FaseProceso.ENSAMBLE, carpeta: 'formato_general' },
    UTI: { fase: FaseProceso.TEST_INICIAL, carpeta: 'formato_general' },
    UR: { fase: FaseProceso.RETEST, carpeta: 'formato_general' },
    UA: { fase: FaseProceso.REGISTRO, carpeta: 'formato_registro' }
  };
  
  return configs[rol] || { fase: null, carpeta: null };
};

/**
 * Guarda un nuevo registro de escaneo desde cualquier formato.
 * Asocia el registro con el usuario logueado y el módem correspondiente.
 */
exports.guardarRegistro = async (req, res) => {
  // Comprobar si la sesión es válida al principio
  if (!req.user || !req.user.id) {
    console.log('Sesión de usuario inválida en guardarRegistro');
    return res.status(401).json({ error: 'Sesión caducada. Por favor, inicie sesión nuevamente.' });
  }

  const userId = req.user.id;
  const userRol = req.user.rol;
  // Extraer campos de la solicitud, incluyendo detalleScrap
  let { sn, scrap, motivoScrap, detalleScrap, sku, finalizarLote, loteId } = req.body;

  // Si se solicita finalizar un lote, delegar a la función específica
  if (finalizarLote && loteId) {
    return this.finalizarLote(req, res);
  }

  // Convertir SN a mayúsculas
  if (sn) sn = sn.toUpperCase().trim();
  
  if (!sn) {
    return res.status(400).json({ error: 'El número de serie (S/N) es obligatorio.' });
  }
  // El SKU solo es obligatorio en la fase de registro (UReg)
  if (userRol === 'UReg' && !sku) {
    return res.status(400).json({ error: 'El SKU es obligatorio para registrar un nuevo lote.' });
  }

  // Extraer el SKU numérico de la cadena completa
  let skuNumber = sku;
  if (sku.includes('-')) {
    skuNumber = sku.split('-')[1].trim();
  }

  const rolConfig = getRolConfig(userRol);
  if (!rolConfig.fase) {
    return res.status(403).json({ error: 'Tu rol no tiene una fase de proceso asignada.' });
  }
  // Bloquear la fase de Empaque en este endpoint; usar registrarModemEmpaque en empaqueController
  if (userRol === 'UE') {
    return res.status(403).json({ error: 'Usa el endpoint de empaque para registrar en la fase de Empaque.' });
  }
  // En función del rol, procesar registro o avance de fase

  try {
    // Verificar si ya existe este S/N en la fase actual
    const existeRegistro = await prisma.registro.findFirst({
      where: { 
        sn,
        fase: rolConfig.fase,
        userId
      },
      orderBy: { createdAt: 'desc' },
      take: 1
    });
    
    if (existeRegistro && 
        new Date().getTime() - new Date(existeRegistro.createdAt).getTime() < 60000) {
      return res.status(400).json({ 
        error: 'Este número de serie ya fue escaneado en los últimos 60 segundos.'
      });
    }

    let modem;
    let loteActivo;
    // Flujo de registro y avance de fase según rol
    if (userRol === 'UReg' || userRol === 'UA') {
      // Registro inicial: crear modem y lote si es necesario
      const skuId = parseInt(sku.includes('-') ? sku.split('-')[1] : sku, 10) || null;
      // Buscar o crear lote de entrada
      loteActivo = await prisma.lote.findFirst({
        where: { skuId, tipoLote: TipoLote.ENTRADA, estado: EstadoLote.EN_PROCESO, esScrap: false }
      });
      if (!loteActivo) {
        const fecha = new Date();
        const numero = `${skuNumber}-${fecha.getFullYear()}${(fecha.getMonth()+1).toString().padStart(2,'0')}${fecha.getDate().toString().padStart(2,'0')}-${uuidv4().slice(0,6)}`;
        loteActivo = await prisma.lote.create({ data: { numero, skuId, tipoLote: TipoLote.ENTRADA, estado: EstadoLote.EN_PROCESO, prioridad:5, responsableId:userId } });
      }
      // Crear modem
      const estadoInit = await prisma.estado.findFirst({ where:{ nombre:'REGISTRO' } });
      modem = await prisma.modem.create({ data:{ sn, skuId, estadoActualId:estadoInit.id, faseActual:rolConfig.fase, loteId:loteActivo.id, responsableId:userId } });
    } else {
      // Avance de fase para UTI (TEST_INICIAL), UEN (ENSAMBLE), UR (RETEST)
      modem = await prisma.modem.findUnique({ where:{ sn } });
      if (!modem) return res.status(404).json({ error:`Módem ${sn} no encontrado.` });
      const fases = [FaseProceso.REGISTRO, FaseProceso.TEST_INICIAL, FaseProceso.ENSAMBLE, FaseProceso.RETEST];
      const actualIdx = fases.indexOf(modem.faseActual);
      const nuevaIdx = fases.indexOf(rolConfig.fase);
      if (actualIdx < 0 || nuevaIdx !== actualIdx +1) {
        return res.status(400).json({ error:`No se puede avanzar de ${modem.faseActual} a ${rolConfig.fase}.` });
      }
      // Actualizar fase
      modem = await prisma.modem.update({ where:{ id:modem.id }, data:{ faseActual:rolConfig.fase, responsableId:userId } });
      loteActivo = await prisma.lote.findUnique({ where:{ id:modem.loteId } });
    }

    // Determinar el estado del registro (OK o SCRAP) y mapear motivos y detalles a enums
    let estadoRegistro = EstadoRegistro.SN_OK;
    let motivoScrapEnum = null;
    let detalleScrapEnum = null;
    if (scrap) {
      // Mapear motivoScrap a enum MotivoScrap y estadoRegistro
      if (motivoScrap) {
        const m = motivoScrap.toString().toLowerCase();
        if (m.includes('cosmetica')) {
          motivoScrapEnum = MotivoScrap.COSMETICA;
          estadoRegistro = EstadoRegistro.SCRAP_COSMETICO;
        } else if (m.includes('fuera') || m.includes('rango') || m.includes('electro')) {
          motivoScrapEnum = MotivoScrap.FUERA_DE_RANGO;
          estadoRegistro = EstadoRegistro.SCRAP_ELECTRONICO;
        } else if (m.includes('infestado') || m.includes('infestacion')) {
          motivoScrapEnum = MotivoScrap.INFESTADO;
          estadoRegistro = EstadoRegistro.SCRAP_INFESTACION;
        } else {
          motivoScrapEnum = MotivoScrap.OTRO;
          estadoRegistro = EstadoRegistro.SCRAP_ELECTRONICO;
        }
      }
      // Mapear detalleScrap a enum DetalleScrap
      if (detalleScrap) {
        const d = detalleScrap.toString().toLowerCase();
        if (d.includes('circuito ok') || d.includes('sirve circuito') || (d.includes('circuito') && d.includes('no base'))) {
          detalleScrapEnum = DetalleScrap.CIRCUITO_OK_BASE_NOK;
        } else if (d.includes('base ok') || d.includes('sirve base')) {
          detalleScrapEnum = DetalleScrap.BASE_OK_CIRCUITO_NOK;
        } else if (d.includes('infestacion')) {
          detalleScrapEnum = DetalleScrap.INFESTACION;
        } else {
          detalleScrapEnum = DetalleScrap.OTRO;
        }
      }
    }

    // Para roles distintos de UReg, validar que la fase actual es la anterior en el flujo
    if (userRol !== 'UReg') {
      const flujo = [
        FaseProceso.REGISTRO,
        FaseProceso.TEST_INICIAL,
        FaseProceso.ENSAMBLE,
        FaseProceso.RETEST,
        FaseProceso.EMPAQUE
      ];
      const faseActual = modem.faseActual;
      const nuevaFase = rolConfig.fase;
      const idxActual = flujo.indexOf(faseActual);
      const idxNueva = flujo.indexOf(nuevaFase);
      if (idxActual < 0 || idxNueva < 0 || idxActual + 1 !== idxNueva) {
        return res.status(400).json({
          error: `No se permite registrar en fase ${nuevaFase} cuando el módem está en fase ${faseActual}.`  
        });
      }
      // Avanzar fase del módem
      modem = await prisma.modem.update({
        where: { id: modem.id },
        data: {
          faseActual: nuevaFase,
          responsableId: userId,
          updatedAt: new Date()
        }
      });
    }
    // Crear el registro en la base de datos
    const nuevoRegistro = await prisma.registro.create({
      data: {
        sn,
        fase: rolConfig.fase,
        estado: estadoRegistro,
        motivoScrap: motivoScrapEnum,
        detalleScrap: detalleScrapEnum,
        userId: userId,
        loteId: modem.loteId,
        modemId: modem.id,
      },
      include: {
        user: {
          select: { id: true, nombre: true },
        },
      },
    });

    // Renovar explícitamente la sesión
    if (req.session) {
      req.session.touch();
    }

    // Incluir el loteId en la respuesta para que el frontend lo capture
    res.status(201).json({
      ...nuevoRegistro,
      loteId: loteActivo ? loteActivo.id : null,
      success: true,
      userName: nuevoRegistro.user ? nuevoRegistro.user.nombre : null
    });
  } catch (error) {
    console.error('Error al guardar el registro:', error);
    res.status(500).json({ error: 'Error interno al guardar el registro.' });
  }
};

/**
 * Finaliza un lote cuando se completa el registro
 */
exports.finalizarLote = async (req, res) => {
  // Verificar sesión
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Sesión caducada. Por favor, inicie sesión nuevamente.' });
  }

  const userId = req.user.id;
  const { loteId } = req.body;
  
  if (!loteId) {
    return res.status(400).json({ error: 'El ID del lote es obligatorio.' });
  }
  
  try {
    const lote = await prisma.lote.findUnique({
      where: { id: parseInt(loteId) }
    });
    
    if (!lote) {
      return res.status(404).json({ error: 'Lote no encontrado.' });
    }
    
    // Verificar que el lote no esté ya completado
    if (lote.estado === 'COMPLETADO') {
      return res.status(400).json({ error: 'Este lote ya ha sido finalizado.' });
    }
    
    // Actualizar el estado del lote a completado
    const loteActualizado = await prisma.lote.update({
      where: { id: parseInt(loteId) },
      data: {
        estado: 'COMPLETADO'
      }
    });
    
    // Registrar en el log
    await prisma.log.create({
      data: {
        accion: 'FINALIZAR_LOTE',
        entidad: 'Lote',
        detalle: `Lote ${lote.numero} finalizado durante registro`,
        userId: userId
      }
    });
    
    // Renovar sesión
    if (req.session) {
      req.session.touch();
    }
    
    res.status(200).json({
      message: 'Lote finalizado correctamente',
      lote: loteActualizado,
      success: true
    });
    
  } catch (error) {
    console.error('Error al finalizar el lote:', error);
    res.status(500).json({ error: 'Error interno al finalizar el lote.' });
  }
};

/**
 * Verifica si un rol tiene acceso a una carpeta específica
 */
exports.verificarAccesoCarpeta = (rol, carpeta) => {
  const rolConfig = getRolConfig(rol);
  return rolConfig.carpeta === carpeta;
};

/**
 * Obtiene la carpeta correspondiente a un rol
 */
exports.obtenerCarpetaPorRol = (rol) => {
  const rolConfig = getRolConfig(rol);
  return rolConfig.carpeta;
};