const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logService = require('../services/logService');

/**
 * Renderiza la vista del inventario de cosméticos.
 */
exports.renderInventario = async (req, res) => {
  try {
    const inventario = await prisma.inventarioCosmetico.findMany({
      include: {
        sku: true,
      },
      orderBy: [
        { sku: { nombre: 'asc' } },
        { tipoInsumo: 'asc' }
      ]
    });

    // Agrupar por SKU para la vista
    const inventarioAgrupado = inventario.reduce((acc, item) => {
      if (!acc[item.sku.nombre]) {
        acc[item.sku.nombre] = {
          skuId: item.sku.id,
          skuItem: item.sku.skuItem,
          CAPUCHONES: 0,
          BASES: 0,
          TAPAS: 0,
        };
      }
      acc[item.sku.nombre][item.tipoInsumo] = item.cantidad;
      return acc;
    }, {});

    res.render('cosmetica_inventario', {
      user: req.user,
      inventario: inventarioAgrupado,
      page_name: 'cosmetica'
    });
  } catch (error) {
    console.error('Error al renderizar inventario de cosmética:', error);
    res.status(500).render('error', { message: 'Error al cargar el inventario' });
  }
};

/**
 * Registra un movimiento (entrada/salida) de insumos.
 */
exports.registrarMovimiento = async (req, res) => {
  const { skuId, tipoInsumo, tipoMovimiento, cantidad } = req.body;
  const userId = req.user.id;

  if (!skuId || !tipoInsumo || !tipoMovimiento || !cantidad) {
    return res.status(400).json({ success: false, message: 'Todos los campos son requeridos.' });
  }

  const cantidadNum = parseInt(cantidad, 10);
  if (isNaN(cantidadNum) || cantidadNum <= 0) {
    return res.status(400).json({ success: false, message: 'La cantidad debe ser un número positivo.' });
  }

  try {
    const inventarioItem = await prisma.inventarioCosmetico.findUnique({
      where: { skuId_tipoInsumo: { skuId: parseInt(skuId), tipoInsumo } },
      include: { sku: true }
    });

    if (tipoMovimiento === 'SALIDA' && inventarioItem.cantidad < cantidadNum) {
      return res.status(400).json({ success: false, message: `Stock insuficiente. Stock actual de ${tipoInsumo} para ${inventarioItem.sku.nombre}: ${inventarioItem.cantidad}.` });
    }

    const updateOperation = tipoMovimiento === 'ENTRADA' ? { increment: cantidadNum } : { decrement: cantidadNum };

    const [, inventarioActualizado] = await prisma.$transaction([
      prisma.registroInsumo.create({
        data: { tipoMovimiento, tipoInsumo, cantidad: cantidadNum, skuId: parseInt(skuId), responsableId: userId }
      }),
      prisma.inventarioCosmetico.update({
        where: { skuId_tipoInsumo: { skuId: parseInt(skuId), tipoInsumo } },
        data: { cantidad: updateOperation }
      })
    ]);

    await logService.registrarAccion({
      accion: `MOVIMIENTO_COSMETICO_${tipoMovimiento}`,
      entidad: 'InventarioCosmetico',
      detalle: `SKU ID: ${skuId}, Insumo: ${tipoInsumo}, Cantidad: ${cantidadNum}`,
      userId
    });

    res.status(200).json({ success: true, message: 'Movimiento registrado exitosamente.', data: inventarioActualizado });
  } catch (error) {
    console.error('Error al registrar movimiento de cosmética:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

