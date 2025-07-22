const express = require('express');
const router = express.Router();
const { verificarAuth, verificarRol } = require('../controllers/authController');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const adminController = require('../controllers/adminController');
const { vistaEditarUsuario } = require('../controllers/adminController');

// --- VISTA POR SKU (actualizado según C1) ---
router.get('/seleccionar-sku', verificarAuth, async (req, res) => {
  try {
    const user = req.user;
    const skuId = parseInt(req.params.skuCode);

    const sku = await prisma.catalogoSKU.findUnique({
      where: { id: skuId }
    });

    if (!sku) {
      return res.status(404).send('SKU no encontrado');
    }

    // Buscar la vista exacta para el SKU y el rol del usuario
    const vistaSKU = await prisma.vistaPorSKU.findFirst({
      where: {
        skuId: sku.id,
        rol: user.rol
      }
    });

    if (!vistaSKU) {
      return res.status(404).send('No hay vista registrada para este SKU y rol');
    }

    // Determinar carpeta por rol
    let carpetaVista = '';
    if (user.rol === 'UReg') {
      carpetaVista = 'formato_registro';
    } else if (user.rol === 'UE') {
      carpetaVista = 'formato_empaque';
    } else {
      carpetaVista = 'formato_general';
    }

    // Renderizar vista con ruta completa (ej: formato_registro/4KM36BLANCO_69360)
    res.render(`${carpetaVista}/${vistaSKU.vista}`, { user });
  } catch (error) {
    console.error('Error al obtener vista por SKU:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Ruta pública para registro de usuario (debe estar antes de cualquier middleware de autenticación)
router.get('/registro_prueba', (req, res) => {
  res.render('dasboard_registro');
});

// Dashboard para editar usuarios
router.get('/editarusuario/:id',
  verificarAuth,
  verificarRol(['UAI', 'UA']),
  vistaEditarUsuario
);

// Dashboard para rol Admin inventario
router.get(
  '/adminventario',
  verificarAuth,
  verificarRol(['UAI', 'UA', 'UV']),
  adminController.listarUsuarios
);

// Tabla de contabilidad por SKU (resumen_totales)
router.get('/resumen_totales', verificarAuth, verificarRol(['UAI']), async (req, res) => {
  try {
    const skuData = await prisma.$queryRaw`
      WITH fases AS (
        SELECT DISTINCT m."faseActual" 
        FROM "Modem" m
        WHERE m."deletedAt" IS NULL
      ),
      fase_entrada AS (
        SELECT MIN(f."faseActual") AS fase_inicial
        FROM fases f
      ),
      fase_salida AS (
        SELECT MAX(f."faseActual") AS fase_final
        FROM fases f
      )
      SELECT 
        c.nombre,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" = (SELECT fase_inicial FROM fase_entrada)
         AND m."deletedAt" IS NULL) as entrada,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" = (SELECT fase_final FROM fase_salida)
         AND m."deletedAt" IS NULL) as salida,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" NOT IN ((SELECT fase_inicial FROM fase_entrada), (SELECT fase_final FROM fase_salida))
         AND m."deletedAt" IS NULL) as "enProceso"
      FROM "CatalogoSKU" c
      ORDER BY c.nombre
    `;
    const processedData = skuData.map(item => ({
      nombre: item.nombre,
      entrada: Number(item.entrada),
      salida: Number(item.salida),
      enProceso: Number(item.enProceso)
    }));
    res.render('resumen_totales', { user: req.user, skuData: processedData });
  } catch (error) {
    console.error('Error al cargar datos de resumen_totales:', error);
    res.render('resumen_totales', { user: req.user, skuData: [] });
  }
});

// Dashboard para rol registro
router.get('/registro',
  verificarAuth,
  verificarRol(['UReg']),
  (req, res) => {
    res.render('registro_lote', { user: req.user });
  }
);

router.get('/seleccionlote',
  verificarAuth,
  verificarRol(['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL', 'UReg']),
  (req, res) => {
    console.log(`Acceso autorizado: ${req.user.userName} (${req.user.rol}) -> /seleccionlote`);
    res.render('seleccion_modelo', { user: req.user });
  }
);

// Dashboard para rol almacen
router.get('/almacen',
  verificarAuth,
  verificarRol('UA'),
  (req, res) => {
    res.render('dashboard_almacen', { user: req.user });
  }
);

// Dashboard para rol visualizador
router.get('/nuevos_usuarios',
  verificarAuth,
  verificarRol('UV'),
  (req, res) => {
    res.render('nuevos_usuarios', { user: req.user });
  }
);

// Dashboard para redireccionamiento a la vista de crear lote
router.get('/crearlote',
  (req, res) => {
    res.render('asignacion_lote', { user: req.user });
  }
);

// Dashboard para rol Test inicial
router.get('/testini',
  verificarAuth,
  verificarRol('UTI'),
  (req, res) => {
    res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol retest
router.get('/retest',
  verificarAuth,
  verificarRol('UR'),
  (req, res) => {
    res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol Cosmetica
router.get('/cosmetica',
  verificarAuth,
  verificarRol('UC'),
  (req, res) => {
    res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol Empaque
router.get('/empaque',
  verificarAuth,
  verificarRol('UE'),
  (req, res) => {
    res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para Liberacion y limpieza
router.get('/lineaLote',
  verificarAuth,
  verificarRol('ULL'),
  (req, res) => {
    res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para Registro
router.get('/Registros',
  verificarAuth,
  verificarRol('UReg'),
  (req, res) => {
    res.render('dashboard_registros', { user: req.user });
  }
);

// Vista de estadísticas por SKU específico
router.get('/sku/:skuId',
  verificarAuth,
  verificarRol(['UAI', 'UA', 'UV']),
  async (req, res) => {
    try {
      const skuId = parseInt(req.params.skuId);
      const sku = await prisma.catalogoSKU.findUnique({
        where: { id: skuId }
      });

      if (!sku) {
        return res.status(404).render('error', {
          message: 'SKU no encontrado',
          error: { status: 404 },
          user: req.user
        });
      }

      res.render('sku_estadisticas', {
        user: req.user,
        sku: sku,
        skuId: skuId
      });
    } catch (error) {
      console.error('Error al cargar estadísticas de SKU:', error);
      res.status(500).render('error', {
        message: 'Error al cargar estadísticas',
        error: { status: 500 },
        user: req.user
      });
    }
  }
);

// Vista de gráficas (resumen)
router.get('/resumen', verificarAuth, verificarRol(['UAI', 'UA', 'UV']), async (req, res) => {
  try {
    const skuData = await prisma.$queryRaw`
      WITH fases AS (
        SELECT DISTINCT m."faseActual" 
        FROM "Modem" m
        WHERE m."deletedAt" IS NULL
      ),
      fase_entrada AS (
        SELECT MIN(f."faseActual") AS fase_inicial
        FROM fases f
      ),
      fase_salida AS (
        SELECT MAX(f."faseActual") AS fase_final
        FROM fases f
      )
      SELECT 
        c.nombre,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" = (SELECT fase_inicial FROM fase_entrada)
         AND m."deletedAt" IS NULL) as entrada,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" = (SELECT fase_final FROM fase_salida)
         AND m."deletedAt" IS NULL) as salida,
        (SELECT COUNT(*) FROM "Modem" m 
         WHERE m."skuId" = c.id 
         AND m."faseActual" NOT IN ((SELECT fase_inicial FROM fase_entrada), (SELECT fase_final FROM fase_salida))
         AND m."deletedAt" IS NULL) as "enProceso"
      FROM "CatalogoSKU" c
      ORDER BY c.nombre
    `;
    const processedData = skuData.map(item => ({
      nombre: item.nombre,
      entrada: Number(item.entrada),
      salida: Number(item.salida),
      enProceso: Number(item.enProceso)
    }));
    res.render('resumen', {
      user: req.user,
      skuData: processedData
    });
  } catch (error) {
    console.error('Error al cargar datos de resumen:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; text-align: center; }
            .error-container { margin-top: 50px; }
            h1 { color: #d9534f; }
            .btn { display: inline-block; padding: 10px 15px; background-color: #1a9ad7; color: white; 
                   text-decoration: none; border-radius: 4px; margin-top: 20px; }
            .btn:hover { background-color: #0f5a7d; }
            pre { text-align: left; background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; max-width: 90%; margin: 0 auto; }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>Error al cargar datos</h1>
            <p>Se produjo un error al procesar tu solicitud</p>
            <pre>${error.message}</pre>
            <a href="/adminventario" class="btn">Volver al panel</a>
          </div>
        </body>
      </html>
    `);
  }
});

router.get('/terminos',
  verificarAuth,
  verificarRol(['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL', 'UReg', 'UAI']),
  (req, res) => {
    res.render('terminos', { user: req.user });
  }
);

module.exports = router;
