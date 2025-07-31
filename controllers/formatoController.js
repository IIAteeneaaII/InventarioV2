const { PrismaClient, FaseProceso, EstadoLote, TipoLote } = require('@prisma/client');
const prisma = new PrismaClient();
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
  let { sn, scrap, motivoScrap, sku, finalizarLote, loteId } = req.body;

  // Si se solicita finalizar un lote, delegar a la función específica
  if (finalizarLote && loteId) {
    return this.finalizarLote(req, res);
  }

  // Convertir SN a mayúsculas
  if (sn) sn = sn.toUpperCase().trim();
  
  if (!sn || !sku) {
    return res.status(400).json({ error: 'El número de serie (S/N) y el SKU son obligatorios.' });
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

    // Si el rol es UReg (Registro), crear el módem si no existe
    if (userRol === 'UReg') {
      modem = await prisma.modem.findUnique({
        where: { sn },
      });
      
      if (!modem) {
        console.log(`Buscando catálogo para SKU: ${skuNumber}`);
        
        // 1. Buscar el catalogoSKU
        // Búsqueda flexible que prueba diferentes campos incluyendo skuItem
        const catalogoSKU = await prisma.$queryRaw`
          SELECT * FROM "CatalogoSKU" 
          WHERE nombre LIKE ${`%${skuNumber}%`}
          OR id = ${parseInt(skuNumber, 10) || 0}
          OR "skuItem" = ${skuNumber}
          LIMIT 1
        `;
        
        if (!catalogoSKU || catalogoSKU.length === 0) {
          return res.status(404).json({ 
            error: `No existe un catálogo para el SKU ${skuNumber}. Contacte al administrador.`
          });
        }

        const skuId = catalogoSKU[0].id;
        console.log(`CatalogoSKU encontrado: ID=${skuId}, Nombre=${catalogoSKU[0].nombre}`);

        // 2. Buscar el lote activo para este SKU
        loteActivo = await prisma.lote.findFirst({
          where: { 
            skuId: skuId,
            estado: 'EN_PROCESO',
            esScrap: false
          }
        });
        
        // Si no existe un lote activo, crear uno automáticamente
        if (!loteActivo) {
          console.log(`No se encontró lote activo para SKU ${skuNumber}. Creando uno nuevo...`);
          
          // Generar número de lote único: SKU + fecha + código aleatorio
          const fechaActual = new Date();
          const numeroLote = `${skuNumber}-${fechaActual.getFullYear()}${(fechaActual.getMonth()+1).toString().padStart(2, '0')}${fechaActual.getDate().toString().padStart(2, '0')}-${uuidv4().substring(0, 6)}`;
          
          // Crear el nuevo lote
          loteActivo = await prisma.lote.create({
            data: {
              numero: numeroLote,
              skuId: skuId,
              tipoLote: 'ENTRADA',
              estado: 'EN_PROCESO',
              esScrap: false,
              prioridad: 5,
              responsableId: userId
            }
          });
          
          console.log(`Lote creado automáticamente: ${loteActivo.id} - ${loteActivo.numero}`);
          
          // Registrar en el log
          await prisma.log.create({
            data: {
              accion: 'CREAR_LOTE_AUTO',
              entidad: 'Lote',
              detalle: `Lote ${loteActivo.numero} creado automáticamente durante registro de S/N ${sn}`,
              userId: userId
            }
          });
        }

        // 3. Buscar un estado inicial
        const estadoInicial = await prisma.estado.findFirst({
          where: {
            codigoInterno: 'REG'
          }
        });

        if (!estadoInicial) {
          return res.status(404).json({
            error: 'No se encontró un estado inicial para el módem. Contacte al administrador.'
          });
        }

        // 4. Crear el módem nuevo con todos los campos requeridos
        modem = await prisma.modem.create({
          data: {
            sn,
            skuId: skuId,
            estadoActualId: estadoInicial.id,
            faseActual: FaseProceso.REGISTRO,
            loteId: loteActivo.id,
            responsableId: userId
          }
        });
        
        console.log(`Módem creado: ${modem.id}`);
      } else {
        // Si el modem ya existe, obtener su lote para regresar el loteId
        loteActivo = await prisma.lote.findUnique({
          where: { id: modem.loteId }
        });
      }
    } else {
      // Para otros roles, el módem debe existir previamente
      modem = await prisma.modem.findUnique({
        where: { sn },
      });

      if (!modem) {
        return res.status(404).json({ 
          error: `Módem con S/N ${sn} no encontrado. Debe ser registrado primero.` 
        });
      }
      
      // Obtener el lote activo para incluir su ID en la respuesta
      loteActivo = await prisma.lote.findUnique({
        where: { id: modem.loteId }
      });
    }

    // Determinar el estado del registro (OK o SCRAP)
    let estadoRegistro = 'SN_OK';
    let motivoScrapEnum = null;
    
    if (scrap && motivoScrap) {
      estadoRegistro = 'SCRAP_COSMETICO';
      // Mapear el valor de motivoScrap al enum MotivoScrap
      switch (motivoScrap) {
        case 'cosmetica':
          motivoScrapEnum = 'COSMETICA';
          break;
        case 'electronica':
          motivoScrapEnum = 'FUERA_DE_RANGO';
          break;
        case 'infestado':
          motivoScrapEnum = 'INFESTADO';
          break;
        default:
          motivoScrapEnum = 'OTRO';
      }
    }

    // Crear el registro en la base de datos
    const nuevoRegistro = await prisma.registro.create({
      data: {
        sn,
        fase: rolConfig.fase,
        estado: estadoRegistro,
        motivoScrap: motivoScrapEnum,
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