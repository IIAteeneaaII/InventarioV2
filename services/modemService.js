// services/modemService.js

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Valida si la transición de fase es válida según el flujo definido.
 * @param {String} faseActual - Fase actual del módem.
 * @param {String} faseNueva - Fase a la que se quiere mover el módem.
 * @param {String} estadoNuevo - Estado nuevo (opcional, para lógica extendida de reparaciones).
 * @throws Error si la transición es inválida.
 */
export async function validarTransicionFase(faseActual, faseNueva, estadoNuevo = null) {
  const ordenes = {
    ALMACEN: 1,
    TEST_INICIAL: 2,
    COSMETICA: 3,
    LIBERACION_LIMPIEZA: 4,
    RETEST: 5,
    EMPAQUE: 6
  };

  const ordenActual = ordenes[faseActual];
  const ordenNueva = ordenes[faseNueva];

  if (!ordenActual || !ordenNueva) {
    throw new Error(`Fase inválida. Actual: ${faseActual}, Nueva: ${faseNueva}`);
  }

  // No permitir retroceso salvo si es reparación
  if (ordenNueva < ordenActual) {
    if (estadoNuevo !== 'REPARACION') {
      throw new Error(`No puedes retroceder de ${faseActual} a ${faseNueva} salvo para reparación.`);
    }
  }

  // No permitir saltos de más de una fase adelante
  if (ordenNueva > ordenActual + 1) {
    throw new Error(`No puedes saltar fases intermedias de ${faseActual} a ${faseNueva}.`);
  }

  return true;
}
