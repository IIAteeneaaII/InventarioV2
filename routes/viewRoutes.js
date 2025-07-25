const express = require('express');
const router = express.Router();
const { verificarAuth, verificarRol } = require('../controllers/authController');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const adminController = require('../controllers/adminController');
const { vistaEditarUsuario } = require('../controllers/adminController');
const fs = require('fs');
const path = require('path');

// Ruta basada en BD - Si utilizas la tabla VistaPorSKU
router.get('/vista/:skuCode', verificarAuth, async (req, res) => {
  const skuCode = req.params.skuCode;
  const user = req.user;

  try {
    // Buscar el SKU en la tabla CatalogoSKU
    const sku = await prisma.catalogoSKU.findUnique({
      where: { nombre: skuCode }
    });

    if (!sku) {
      return res.status(404).render('404', { message: 'SKU no encontrado' });
    }

    // Buscar la vista correspondiente al rol del usuario
    const vistaAsignada = await prisma.vistaPorSKU.findFirst({
      where: {
        skuId: sku.id,
        rol: user.rol
      }
    });

    if (!vistaAsignada) {
      return res.status(403).render('403', { message: 'No tienes acceso a esta vista' });
    }

    // Renderizar la vista correspondiente
    return res.render(vistaAsignada.vista, { user });
  } catch (error) {
    console.error(error);
    return res.status(500).send('Error interno del servidor');
  }
});

// Ruta pública para registro de usuario
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
//router.get('/adminventario', 
//  verificarAuth, 
//  verificarRol(['UAI', 'UA', 'UV']), 
//  adminController.listarUsuarios
//);

// Tabla de contabilidad por SKU
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

// Ruta principal para selección de lote
router.get('/seleccionlote', 
  verificarAuth,
  verificarRol(['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL','UReg']),
  (req, res) => {
    res.render('seleccion_modelo', { user: req.user });
  }
);

// Ruta alternativa para compatibilidad con guion bajo
router.get('/seleccionar_modelo', 
  verificarAuth,
  verificarRol(['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL','UReg']),
  (req, res) => {
    res.redirect('/seleccionlote');
  }
);

// Dashboard para rol almacen
router.get('/almacen', 
  verificarAuth,   
  verificarRol(['UA']),
  (req, res) => {
      res.render('dashboard_almacen', { user: req.user });
  }
);

// Dashboard para rol visualizador
router.get('/nuevos_usuarios', 
  verificarAuth,   
  verificarRol(['UV']),
  (req, res) => {
      res.render('nuevos_usuarios', { user: req.user });
  }
);

// Dashboard para redireccionamiento a la vista de crear lote
router.get('/crearlote', 
  verificarAuth,
  (req, res) => {
      res.render('asignacion_lote', { user: req.user });
  }
);

// Dashboard para rol Test inicial
router.get('/testini', 
  verificarAuth,   
  verificarRol(['UTI']),
  (req, res) => {
      res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol retest
router.get('/retest', 
  verificarAuth,   
  verificarRol(['UR']),
  (req, res) => {
      res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol Cosmetica
router.get('/cosmetica', 
  verificarAuth,   
  verificarRol(['UC']),
  (req, res) => {
      res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para rol Empaque
router.get('/empaque', 
  verificarAuth,   
  verificarRol(['UE']),
  (req, res) => {
      res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para Liberacion y limpieza
router.get('/lineaLote', 
  verificarAuth,   
  verificarRol(['ULL']),
  (req, res) => {
      res.render('seleccion_lote', { user: req.user });
  }
);

// Dashboard para Registro
router.get('/Registros', 
  verificarAuth,   
  verificarRol(['UReg']),
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
    // Consulta SQL sin referencias a deletedAt
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
    // Convertir BigInt a Number
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
  verificarRol(['UA', 'UV', 'UTI', 'UR', 'UC', 'UE', 'ULL','UReg', 'UAI']), 
  (req, res) => {
      res.render('terminos', { user: req.user });
  }
);

router.post('/seleccionar-sku', verificarAuth, (req, res) => {
  console.log('SKU seleccionado:', req.body.sku);
  res.status(200).json({ ok: true });
});

// NUEVA RUTA - Para archivos basados en carpeta y SKU directamente
router.get('/:carpeta/:sku', verificarAuth, async (req, res) => {
  const { carpeta, sku } = req.params;
  const user = req.user;
  console.log(`Usuario ${user.userName} (${user.rol}) accediendo a ${carpeta}/${sku}`);
  // Validar que el rol tenga acceso a la carpeta
  let tieneAcceso = true;
  if (carpeta === 'formato_empaque' && user.rol !== 'UE') {
    console.warn(`¡Alerta! Usuario con rol ${user.rol} intentando acceder a formato_empaque`);
    tieneAcceso = false;
  } else if (carpeta === 'formato_registro' && user.rol !== 'UReg') {
    tieneAcceso = false;
  }
  if (!tieneAcceso) {
    console.warn(`Usuario con rol ${user.rol} intentó acceder a ${carpeta}/${sku}`);
    return res.status(403).send('No tienes permiso para acceder a esta carpeta');
  }
  const viewsDir = path.join(__dirname, '..', 'views', carpeta);
  try {
    if (!fs.existsSync(viewsDir)) {
      console.error(`La carpeta ${carpeta} no existe`);
      return res.status(404).send(`Carpeta ${carpeta} no encontrada`);
    }
    const files = fs.readdirSync(viewsDir);
    const fileMatch = files.find(f => f.includes(sku) && f.endsWith('.ejs'));
    if (fileMatch) {
      console.log(`Renderizando vista: ${carpeta}/${fileMatch.replace('.ejs', '')}`);
      return res.render(`${carpeta}/${fileMatch.replace('.ejs', '')}`, { user: req.user });
    } else {
      console.error(`No se encontró archivo para SKU ${sku} en la carpeta ${carpeta}`);
      return res.status(404).send(`Vista no encontrada para SKU ${sku} en ${carpeta}`);
    }
  } catch (err) {
    console.error(`Error al buscar vista para SKU ${sku} en ${carpeta}:`, err);
    return res.status(500).send('Error al buscar la vista');
  }
});

// Redireccionamiento de la ruta antigua a la nueva (para compatibilidad)
router.get('/vista/:formato/:sku', verificarAuth, (req, res) => {
  const { formato, sku } = req.params;
  console.log(`Redirigiendo de /vista/${formato}/${sku} a /${formato}/${sku}`);
  res.redirect(`/${formato}/${sku}`);
});

// La ruta con tres parámetros ahora se maneja como caso especial
// para admitir casos donde se pasa el nombre en la URL (opcional)
router.get('/:carpeta/:nombre/:sku', verificarAuth, (req, res) => {
  const { carpeta, sku } = req.params;
  console.log(`Redirigiendo de /${carpeta}/${req.params.nombre}/${sku} a /${carpeta}/${sku}`);
  res.redirect(`/${carpeta}/${sku}`);
});

// búsqueda de NS
router.get('/ns', 
  verificarAuth,   
  verificarRol(['UAI', 'UA', 'UV']),
  (req, res) => {
      res.render('ns', { user: req.user });
  }
);

// Crear nuevos usuarios
router.get('/crearusuario', 
  verificarAuth,   
  verificarRol(['UAI', 'UA', 'UV']),
  (req, res) => {
      res.render('crearusuario', { user: req.user });
  }
);
router.post('/crearusuario', 
  verificarAuth,   
  verificarRol(['UAI', 'UA', 'UV']),
  adminController.register
);

// Crear nuevos usuarios
router.get('/adminventario', 
  verificarAuth,   
  verificarRol(['UAI', 'UA', 'UV']),
  (req, res) => {
      res.render('admin_dashboard', { user: req.user });
  }
);

// Listar usuarios (para admin y roles autorizados)
router.get('/listarusuarios',
  verificarAuth,
  verificarRol(['UAI', 'UA', 'UV']),
  adminController.listarUsuarios
);


module.exports = router;