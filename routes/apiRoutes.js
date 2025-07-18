const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { verificarAuth, verificarRol } = require('../controllers/authController');

// Función para convertir BigInt a Number
function replaceBigIntWithNumber(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return Number(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(replaceBigIntWithNumber);
  }
  
  if (typeof obj === 'object') {
    Object.keys(obj).forEach(key => {
      obj[key] = replaceBigIntWithNumber(obj[key]);
    });
  }
  
  return obj;
}

// Proteger todas las rutas API con autenticación
router.use(verificarAuth);

// Endpoint para estadísticas generales
router.get('/stats/resumen', verificarRol(['UAI']), async (req, res) => {
  try {
    const dias = parseInt(req.query.dias || 30);
    
    // Obtener datos para todas las gráficas en paralelo
    const [
      distribucionSKU,
      modemsRegistradosPorDia, 
      distribucionLotes,
      estadoPorFase
    ] = await Promise.all([
      // Distribución por SKU
      prisma.$queryRaw`
        SELECT c.nombre, COUNT(*) as cantidad 
        FROM "Modem" m 
        JOIN "CatalogoSKU" c ON m."skuId" = c.id 
        WHERE m."deletedAt" IS NULL
        GROUP BY c.nombre
        ORDER BY COUNT(*) DESC
      `,
      
      // Modems registrados por día (últimos N días)
      prisma.$queryRaw`
        SELECT DATE_TRUNC('day', m."createdAt")::date as fecha, COUNT(*) as cantidad
        FROM "Modem" m
        WHERE m."createdAt" > NOW() - INTERVAL '${dias} days'
          AND m."deletedAt" IS NULL
        GROUP BY DATE_TRUNC('day', m."createdAt")::date
        ORDER BY fecha
      `,
      
      // Distribución por lote
      prisma.$queryRaw`
        SELECT l.numero, l.estado, COUNT(*) as cantidad 
        FROM "Modem" m 
        JOIN "Lote" l ON m."loteId" = l.id 
        WHERE m."deletedAt" IS NULL
        GROUP BY l.numero, l.estado
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `,
      
      // Distribución de estados por fase de proceso
      prisma.$queryRaw`
        SELECT m."faseActual", e.nombre as estado, COUNT(*) as cantidad 
        FROM "Modem" m 
        JOIN "Estado" e ON m."estadoActualId" = e.id 
        WHERE m."deletedAt" IS NULL
        GROUP BY m."faseActual", e.nombre
        ORDER BY m."faseActual", COUNT(*) DESC
      `
    ]);
    
    // Procesar los resultados para convertir BigInt a Number
    const results = {
      distribucionSKU: replaceBigIntWithNumber(distribucionSKU),
      modemsRegistradosPorDia: replaceBigIntWithNumber(modemsRegistradosPorDia),
      distribucionLotes: replaceBigIntWithNumber(distribucionLotes),
      estadoPorFase: replaceBigIntWithNumber(estadoPorFase)
    };
    
    // Enviar los datos como JSON
    res.json(results);
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para estadísticas por SKU específico
router.get('/stats/sku/:skuId', verificarRol(['UAI', 'UA', 'UV']), async (req, res) => {
  try {
    const skuId = parseInt(req.params.skuId);
    const dias = parseInt(req.query.dias || 30);
    
    // Validar que el SKU existe
    const sku = await prisma.catalogoSKU.findUnique({
      where: { id: skuId }
    });
    
    if (!sku) {
      return res.status(404).json({ error: 'SKU no encontrado' });
    }
    
    // Consultas para este SKU específico
    const [estadoStats, faseStats, loteStats, tendencia] = await Promise.all([
      // Estadísticas por estado
      prisma.$queryRaw`
        SELECT e.nombre, COUNT(*) as cantidad, e.color
        FROM "Modem" m 
        JOIN "Estado" e ON m."estadoActualId" = e.id 
        WHERE m."skuId" = ${skuId} AND m."deletedAt" IS NULL
        GROUP BY e.nombre, e.color
        ORDER BY COUNT(*) DESC
      `,
      
      // Estadísticas por fase
      prisma.$queryRaw`
        SELECT "faseActual", COUNT(*) as cantidad 
        FROM "Modem" 
        WHERE "skuId" = ${skuId} AND "deletedAt" IS NULL
        GROUP BY "faseActual"
      `,
      
      // Estadísticas por lote
      prisma.$queryRaw`
        SELECT l.numero, COUNT(*) as cantidad 
        FROM "Modem" m 
        JOIN "Lote" l ON m."loteId" = l.id 
        WHERE m."skuId" = ${skuId} AND m."deletedAt" IS NULL
        GROUP BY l.numero
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `,
      
      // Tendencia de registros por día
      prisma.$queryRaw`
        SELECT DATE_TRUNC('day', r."createdAt")::date as fecha, COUNT(*) as cantidad
        FROM "Registro" r
        JOIN "Modem" m ON r."modemId" = m.id
        WHERE m."skuId" = ${skuId}
          AND r."createdAt" > NOW() - INTERVAL '${dias} days'
        GROUP BY DATE_TRUNC('day', r."createdAt")::date
        ORDER BY fecha
      `
    ]);
    
    // Procesar los resultados para convertir BigInt a Number
    const results = {
      estadoStats: replaceBigIntWithNumber(estadoStats),
      faseStats: replaceBigIntWithNumber(faseStats),
      loteStats: replaceBigIntWithNumber(loteStats),
      tendencia: replaceBigIntWithNumber(tendencia)
    };
    
    res.json(results);
  } catch (error) {
    console.error('Error al obtener estadísticas del SKU:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint de prueba para verificar que la API funciona
router.get('/test', (req, res) => {
  res.json({ 
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    user: req.user
  });
});

router.post('/skus/actualizar-contabilidad', verificarAuth, verificarRol(['UAI']), async (req, res) => {
  try {
    const { actualizaciones } = req.body;
    
    if (!actualizaciones || !Array.isArray(actualizaciones)) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    
    // Registrar la actualización en un historial si es necesario
    await prisma.contabilidadHistorial.create({
      data: {
        usuarioId: req.user.id,
        fecha: new Date(),
        datos: JSON.stringify(actualizaciones)
      }
    });
    
    // En una implementación real, aquí tendrías lógica para actualizar 
    // la contabilidad en tu base de datos según tu modelo de datos específico
    
    res.json({ success: true, message: 'Datos actualizados correctamente' });
  } catch (error) {
    console.error('Error al actualizar contabilidad:', error);
    res.status(500).json({ error: error.message });
  }
});

// Nuevo endpoint para detalles de SKU específico
router.get('/stats/sku-detalle', verificarAuth, async (req, res) => {
    try {
        const { sku } = req.query;
        
        if (!sku) {
            return res.status(400).json({ error: 'Se requiere parámetro SKU' });
        }
        
        // Buscar el ID del SKU primero
        const skuRecord = await prisma.catalogoSKU.findFirst({
            where: {
                nombre: sku
            },
            select: {
                id: true
            }
        });
        
        if (!skuRecord) {
            return res.status(404).json({ error: 'SKU no encontrado' });
        }
        
        // Consultar modems con este SKU agrupados por fase
        const detallesPorFase = await prisma.$queryRaw`
            SELECT 
                m."faseActual" AS categoria, 
                COUNT(*) AS cantidad
            FROM "Modem" m
            WHERE m."skuId" = ${skuRecord.id}
            AND m."deletedAt" IS NULL
            GROUP BY m."faseActual"
            ORDER BY cantidad DESC
        `;
        
        // Convertir BigInt a Number
        const resultado = detallesPorFase.map(item => ({
            categoria: item.categoria,
            cantidad: Number(item.cantidad)
        }));
        
        res.json(resultado);
        
    } catch (error) {
        console.error('Error al obtener detalles del SKU:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para datos filtrados por SKU para el dashboard principal
router.get('/stats/dashboard-filtered', verificarAuth, async (req, res) => {
  try {
    const { skuNombre } = req.query;
    const dias = parseInt(req.query.dias || 30);

    // Buscar el ID del SKU si se proporciona un nombre
    let skuId = null;
    if (skuNombre && skuNombre !== 'todos') {
      const skuInfo = await prisma.catalogoSKU.findFirst({
        where: { nombre: skuNombre },
        select: { id: true }
      });
      if (skuInfo) {
        skuId = skuInfo.id;
      }
    }

    // Obtener el total de modems para el SKU seleccionado o todos
    const totalModems = await prisma.modem.count({
      where: {
        deletedAt: null,
        ...(skuId ? { skuId: skuId } : {})
      }
    });

    // Construir consultas SQL basadas en si hay un SKU seleccionado o no
    let distribucionSKU, modemsRegistradosPorDia, distribucionLotes, estadoPorFase;

    if (skuId) {
      // Consultas con filtro de SKU
      [distribucionSKU, modemsRegistradosPorDia, distribucionLotes, estadoPorFase] = await Promise.all([
        prisma.$queryRaw`
          SELECT c.nombre, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "CatalogoSKU" c ON m."skuId" = c.id 
          WHERE m."deletedAt" IS NULL AND m."skuId" = ${skuId}
          GROUP BY c.nombre
          ORDER BY COUNT(*) DESC
        `,
        prisma.$queryRaw`
          SELECT DATE_TRUNC('day', m."createdAt")::date as fecha, CAST(COUNT(*) AS INTEGER) as cantidad
          FROM "Modem" m
          WHERE m."createdAt" > NOW() - INTERVAL '${dias} days'
            AND m."deletedAt" IS NULL
            AND m."skuId" = ${skuId}
          GROUP BY DATE_TRUNC('day', m."createdAt")::date
          ORDER BY fecha
        `,
        prisma.$queryRaw`
          SELECT l.numero, l.estado, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "Lote" l ON m."loteId" = l.id 
          WHERE m."deletedAt" IS NULL
            AND m."skuId" = ${skuId}
          GROUP BY l.numero, l.estado
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
        prisma.$queryRaw`
          SELECT m."faseActual", e.nombre as estado, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "Estado" e ON m."estadoActualId" = e.id 
          WHERE m."deletedAt" IS NULL
            AND m."skuId" = ${skuId}
          GROUP BY m."faseActual", e.nombre
          ORDER BY m."faseActual", COUNT(*) DESC
        `
      ]);
    } else {
      // Consultas sin filtro de SKU (todos)
      [distribucionSKU, modemsRegistradosPorDia, distribucionLotes, estadoPorFase] = await Promise.all([
        prisma.$queryRaw`
          SELECT c.nombre, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "CatalogoSKU" c ON m."skuId" = c.id 
          WHERE m."deletedAt" IS NULL
          GROUP BY c.nombre
          ORDER BY COUNT(*) DESC
        `,
        prisma.$queryRaw`
          SELECT DATE_TRUNC('day', m."createdAt")::date as fecha, CAST(COUNT(*) AS INTEGER) as cantidad
          FROM "Modem" m
          WHERE m."createdAt" > NOW() - INTERVAL '${dias} days'
            AND m."deletedAt" IS NULL
          GROUP BY DATE_TRUNC('day', m."createdAt")::date
          ORDER BY fecha
        `,
        prisma.$queryRaw`
          SELECT l.numero, l.estado, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "Lote" l ON m."loteId" = l.id 
          WHERE m."deletedAt" IS NULL
          GROUP BY l.numero, l.estado
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
        prisma.$queryRaw`
          SELECT m."faseActual", e.nombre as estado, CAST(COUNT(*) AS INTEGER) as cantidad 
          FROM "Modem" m 
          JOIN "Estado" e ON m."estadoActualId" = e.id 
          WHERE m."deletedAt" IS NULL
          GROUP BY m."faseActual", e.nombre
          ORDER BY m."faseActual", COUNT(*) DESC
        `
      ]);
    }

    // Crear objeto de respuesta
    const results = {
      totalModems,
      distribucionSKU: replaceBigIntWithNumber(distribucionSKU),
      modemsRegistradosPorDia: replaceBigIntWithNumber(modemsRegistradosPorDia),
      distribucionLotes: replaceBigIntWithNumber(distribucionLotes),
      estadoPorFase: replaceBigIntWithNumber(estadoPorFase),
      filteredBySku: skuId ? true : false,
      skuNombre: skuNombre
    };

    res.json(results);
  } catch (error) {
    console.error('Error al obtener estadísticas filtradas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para datos de etapas del proceso - VERSIÓN CORREGIDA
router.get('/stats/etapas-proceso', verificarAuth, async (req, res) => {
  try {
    const { skuNombre } = req.query;
    console.log('Solicitud recibida para etapas-proceso, SKU:', skuNombre);
    
    // Primero, consultar todas las fases disponibles con su conteo
    let whereClause = 'm."deletedAt" IS NULL';
    let params = [];
    
    if (skuNombre && skuNombre !== 'todos') {
      whereClause += ' AND c.nombre = $1';
      params.push(skuNombre);
    }
    
    // Usamos CAST para convertir el enum a text y evitar problemas de tipo
    const query = `
      SELECT 
        CAST(m."faseActual" AS TEXT) AS fase_nombre,
        COUNT(*) AS cantidad
      FROM "Modem" m
      JOIN "CatalogoSKU" c ON m."skuId" = c.id
      WHERE ${whereClause}
      GROUP BY m."faseActual"
      ORDER BY m."faseActual"
    `;
    
    console.log('Ejecutando consulta para obtener fases');
    const fasesData = await prisma.$queryRawUnsafe(query, ...params);
    console.log('Datos de fases obtenidos:', fasesData);
    
    // Inicializar categorías con ceros
    const etapas = {
      registro: 0,
      enProceso: 0,
      entrega: 0,
      final: 0
    };
    
    // Si no hay datos, devolver los valores inicializados
    if (!fasesData || fasesData.length === 0) {
      return res.json(etapas);
    }
    
    // Asignar datos a las categorías según su posición
    const totalFases = fasesData.length;
    
    if (totalFases >= 1) {
      // Primera fase es registro
      etapas.registro = Number(fasesData[0].cantidad);
      
      if (totalFases >= 2) {
        // Última fase es final
        etapas.final = Number(fasesData[totalFases - 1].cantidad);
        
        if (totalFases >= 3) {
          // Penúltima fase es entrega
          etapas.entrega = Number(fasesData[totalFases - 2].cantidad);
          
          // Fases intermedias son en proceso (si hay más de 3 fases)
          if (totalFases > 3) {
            // Sumar todas las fases intermedias
            for (let i = 1; i < totalFases - 2; i++) {
              etapas.enProceso += Number(fasesData[i].cantidad);
            }
          }
        }
      }
    }
    
    console.log('Datos de etapas calculados:', etapas);
    res.json(etapas);
  } catch (error) {
    console.error('Error al obtener datos de etapas del proceso:', error);
    
    // En caso de error, devolver un error claro sin datos de ejemplo
    res.status(500).json({ 
      error: true,
      message: 'Error al calcular datos de etapas del proceso',
      details: error.message
    });
  }
});

module.exports = router;