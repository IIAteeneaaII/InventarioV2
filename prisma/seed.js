const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();


async function main() {
  
  // Seed de CatalogoSKU
  const skuData = [
    { id: 3, nombre: "4KM36A", skuItem: "81809" },
    { id: 1, nombre: "4KM37", skuItem: "69746" },
    { id: 2, nombre: "4KM36B", skuItem: "69360" },
    { id: 4, nombre: "EXTENDERAP", skuItem: "72608" },
    { id: 5, nombre: "EXTENDERHUAWEI", skuItem: "67278" },
    { id: 6, nombre: "APEH7", skuItem: "80333" },
    { id: 7, nombre: "4KALEXA", skuItem: "73488" },
    { id: 8, nombre: "V5SMALL", skuItem: "72676" },
    { id: 9, nombre: "V5", skuItem: "66262" },
    { id: 10, nombre: "FIBERHOME", skuItem: "69643" },
    { id: 11, nombre: "ZTE", skuItem: "69644" },
    { id: 12, nombre: "X6", skuItem: "79735" },
    { id: 13, nombre: "FIBERHOMEEXTENDED", skuItem: "74497" },
    { id: 14, nombre: "SOUNDBOX", skuItem: "69358" },
  ];

  for (const item of skuData) {
    await prisma.catalogoSKU.upsert({
      where: { nombre: item.nombre },
      update: { skuItem: item.skuItem },
      create: {
        id: item.id,
        nombre: item.nombre,
        skuItem: item.skuItem
      }
    });
  }
  console.log('CatalogoSKU seed completado');

  // Seed de Estados/Fases principales (usa solo nombres en mayúsculas y subrayado)
  const estados = [
    { id: 0, nombre: "REGISTRO", codigoInterno: "REG" },
    { id: 1, nombre: "TEST_INICIAL", codigoInterno: "TI" },
    { id: 2, nombre: "ENSAMBLE", codigoInterno: "ENS" }, // Nuevo estado
    { id: 4, nombre: "RETEST", codigoInterno: "RET" }, // Se mantiene ID para consistencia
    { id: 5, nombre: "EMPAQUE", codigoInterno: "EMP" },
    { id: 6, nombre: "SCRAP", codigoInterno: "SCR" },
    { id: 7, nombre: "REPARACION", codigoInterno: "REP" },
  ];

  for (const estado of estados) {
    await prisma.estado.upsert({
      where: { id: estado.id },
      update: {},
      create: estado,
    });
  }
  console.log('Estados seed completado');

  // Obtener todos los estados y crear un mapa nombre -> id
  const estadosDb = await prisma.estado.findMany();
  const estadoMap = {};
  estadosDb.forEach(e => estadoMap[e.nombre] = e.id);

  // Seed de Transiciones permitidas usando los IDs de estado
  const transiciones = [];
  let idTrans = 1;
  // Flujo principal actualizado
  const flow = ["REGISTRO", "TEST_INICIAL", "ENSAMBLE", "RETEST", "EMPAQUE"];
  // Define los roles permitidos para cada transición
  const rolesPorTransicion = {
    "REGISTRO->TEST_INICIAL": "UA", // Almacén solamente
    "TEST_INICIAL->ENSAMBLE": "UTI,UA", // Nuevo flujo
    "ENSAMBLE->RETEST": "UEN,UA", // UEN es responsable de Ensamble
    "RETEST->EMPAQUE": "UR,UA",
    "EMPAQUE->SCRAP": "UE,UA",
    // Scrap y Reparacion pueden tener reglas propias
  };

  for (let i = 0; i < flow.length - 1; i++) {
    const from = flow[i];
    const to = flow[i + 1];
    const key = `${from}->${to}`;
    const roles = rolesPorTransicion[key] || "UA"; // Por defecto solo admin almacén

    // Completar
    transiciones.push({
      id: idTrans++,
      estadoDesdeId: estadoMap[from],
      estadoHaciaId: estadoMap[to],
      nombreEvento: `Completar ${from}`,
      rolesPermitidos: roles
    });

    // Scrap (permitir mandar a scrap desde cualquier estado excepto Empaque)
    if (from !== "EMPAQUE") {
      let rolesScrap = "UA,UTI,UR,UE,UReg"; // Se quita UV, UC, ULL, UEN
      if (from === "REGISTRO") rolesScrap = "UA";
      transiciones.push({
        id: idTrans++,
        estadoDesdeId: estadoMap[from],
        estadoHaciaId: estadoMap["SCRAP"],
        nombreEvento: `Rechazar ${from}`,
        rolesPermitidos: rolesScrap
      });
    }
    // Reparar (excepto desde Empaque)
    if (from !== "EMPAQUE") {
      transiciones.push({
        id: idTrans++,
        estadoDesdeId: estadoMap[from],
        estadoHaciaId: estadoMap["REPARACION"],
        nombreEvento: `Reparar ${from}`,
        rolesPermitidos: "UR,UTI,UA"
      });
    }
    // Reintegrar (excepto desde REGISTRO)
    if (from !== "REGISTRO") {
      transiciones.push({
        id: idTrans++,
        estadoDesdeId: estadoMap[from],
        estadoHaciaId: estadoMap[from],
        nombreEvento: `Reintegrar ${from}`,
        rolesPermitidos: "UR,UTI,UA"
      });
    }
  }
  // Transiciones desde Reparacion: regresar solo al estado de donde vino y a Scrap
  for (let i = 1; i < flow.length - 1; i++) {
    const from = flow[i];
    transiciones.push({
      id: idTrans++,
      estadoDesdeId: estadoMap["REPARACION"],
      estadoHaciaId: estadoMap[from],
      nombreEvento: `Regresar a ${from} desde Reparacion`,
      rolesPermitidos: "UR,UTI,UA"
    });
  }
  // Reparacion -> Scrap
  transiciones.push({
    id: idTrans++,
    estadoDesdeId: estadoMap["REPARACION"],
    estadoHaciaId: estadoMap["SCRAP"],
    nombreEvento: `Rechazar desde Reparacion`,
    rolesPermitidos: "UA"
  });

  // Limpia la tabla antes de insertar (opcional, recomendado)
  await prisma.transicionEstado.deleteMany({});

  for (const trans of transiciones) {
    if (trans.estadoDesdeId === undefined || trans.estadoHaciaId === undefined) {
      console.error('Transición con estado undefined:', trans);
      continue;
    }
    await prisma.transicionEstado.upsert({
      where: { estadoDesdeId_nombreEvento: { estadoDesdeId: trans.estadoDesdeId, nombreEvento: trans.nombreEvento } },
      update: {},
      create: {
        nombreEvento: trans.nombreEvento,
        rolesPermitidos: trans.rolesPermitidos,
        estadoDesde: { connect: { id: trans.estadoDesdeId } },
        estadoHacia: { connect: { id: trans.estadoHaciaId } },
      },
    });
  }
  console.log('Transiciones seed completado');

  // Crea o reemplaza la función obtener_transiciones_disponibles en la base de datos
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION obtener_transiciones_disponibles(
        p_modem_id INTEGER,
        p_user_id INTEGER
    )
    RETURNS TABLE(nombre_evento TEXT) AS $$
    DECLARE
        v_estado_actual_id INTEGER;
        v_rol_usuario TEXT;
    BEGIN
        -- Obtener el estado actual del módem
        SELECT m."estadoActualId" INTO v_estado_actual_id
        FROM "Modem" m WHERE m.id = p_modem_id;

        -- Obtener el rol del usuario
        SELECT u.rol::TEXT INTO v_rol_usuario
        FROM "User" u WHERE u.id = p_user_id;

        -- Devolver las transiciones disponibles según el estado y rol
        RETURN QUERY
        SELECT te."nombreEvento"
        FROM "TransicionEstado" te
        WHERE te."estadoDesdeId" = v_estado_actual_id
          AND (
            te."rolesPermitidos" IS NULL
            OR te."rolesPermitidos" ~ ('(^|,)' || v_rol_usuario || '(,|$)')
            OR v_rol_usuario = 'UA'
          );
    END;
    $$ LANGUAGE plpgsql;
  `);

  // ========== SEED DE CÓDIGOS DE REPARACIÓN ==========
  console.log('Iniciando seed de códigos de reparación...');
  
  const codigosReparacion = [
    { codigo: 'N001', descripcion: 'EQUIPO OK' },
    { codigo: 'N002', descripcion: 'LIMPIEZA' },
    { codigo: 'N003', descripcion: 'RESTAURACION' },
    { codigo: 'N004', descripcion: 'RESETEO' },
    { codigo: 'N005', descripcion: 'REINSTALACION DE FIRMWARE' },
    { codigo: 'N006', descripcion: 'CAMBIO DE CONECTORES' },
    { codigo: 'N007', descripcion: 'RESOLDE' },
    { codigo: 'N008', descripcion: 'RESOLDE DE BGA' },
    { codigo: 'N009', descripcion: 'CAMBIO DE COMPONENTE DISCRETO TH' },
    { codigo: 'N010', descripcion: 'CAMBIO DE COMPONENTE DISCRETO SMT' },
    { codigo: 'N011', descripcion: 'CAMBIO DE CI ANALOGICO TH' },
    { codigo: 'N012', descripcion: 'CAMBIO DE CI ANALOGICO SMT' },
    { codigo: 'N013', descripcion: 'CAMBIO DE CI DIGITAL TH' },
    { codigo: 'N014', descripcion: 'CAMBIO DE CI DIGITAL SMT' },
    { codigo: 'N015', descripcion: 'LIMPIEZA CONECTOR DE FO' },
    { codigo: 'N016', descripcion: 'NO SE ESPECIFICA' },
    { codigo: 'SC1', descripcion: 'SCRAP ORIGEN' },
    { codigo: 'SC2', descripcion: 'SCRAP PROCESO' },
    { codigo: 'SC3', descripcion: 'SCRAP FUERA DE ALCANCE' }
  ];

  for (const codigo of codigosReparacion) {
    await prisma.codigoReparacion.upsert({
      where: { codigo: codigo.codigo },
      update: { descripcion: codigo.descripcion },
      create: {
        codigo: codigo.codigo,
        descripcion: codigo.descripcion
      }
    });
  }
  console.log('Códigos de reparación seed completado');

  // ========== SEED DE CÓDIGOS DE DAÑO ==========
  console.log('Iniciando seed de códigos de daño...');
  
  // Primero obtenemos los IDs de los códigos de reparación
  const codigosRep = await prisma.codigoReparacion.findMany({
    select: { id: true, codigo: true }
  });
  
  const getRepId = (codigo) => codigosRep.find(c => c.codigo === codigo)?.id;

  const codigosDano = [
    { codigo: 'D000', descripcion: 'EQUIPO OK', codigoRepId: getRepId('N001'), nivelRep: 'NA', scrap: 'NA' },
    { codigo: 'D001', descripcion: 'LIMPIEZA (POLVO, TIERRA, GRASA)', codigoRepId: getRepId('N002'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D002', descripcion: 'PROGRAMA/CONFIGURACION BORRADA O DEFECTUOSA', codigoRepId: getRepId('N003'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D003', descripcion: 'PROGRAMA COLGADO', codigoRepId: getRepId('N004'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D004', descripcion: 'ACTUALIZACION DE FIRMWARE', codigoRepId: getRepId('N005'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D005', descripcion: 'CONECTOR ROTO, MAL CONTACTO', codigoRepId: getRepId('N006'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D006', descripcion: 'SOLDADURA CRISTALIZADA', codigoRepId: getRepId('N007'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D007', descripcion: 'SOLDADURA CRISTALIZADA DE BGA', codigoRepId: getRepId('N008'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D008', descripcion: 'DEFECTO DE COMPONENTE DISCRETO TH', codigoRepId: getRepId('N009'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D009', descripcion: 'DEFECTO DE COMPONENTE DISCRETO SMT', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D010', descripcion: 'DEFECTO DE CI ANALOGICO TH', codigoRepId: getRepId('N011'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D011', descripcion: 'DEFECTO DE CI ANALOGICO SMT', codigoRepId: getRepId('N012'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D012', descripcion: 'DEFECTO DE CI DIGITAL TH', codigoRepId: getRepId('N013'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D013', descripcion: 'DEFECTO DE CI DIGITAL SMT', codigoRepId: getRepId('N014'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D014', descripcion: 'DAÑO IRREVERSIBLE EN PCB', codigoRepId: getRepId('SC3'), nivelRep: 'N2_PLUS', scrap: 'SC3' },
    { codigo: 'D015', descripcion: 'COMPONENTE NO DISPONIBLE', codigoRepId: getRepId('SC3'), nivelRep: 'N2_PLUS', scrap: 'SC3' },
    { codigo: 'D016', descripcion: 'CONECTOR DE FO SUCIO', codigoRepId: getRepId('N015'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'D017', descripcion: 'DEFECTO DE PUERTO LAN', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D018', descripcion: 'DEFECTO DE PUERTO USB', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D019', descripcion: 'DEFECTO DE PUERTO POWER', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D020', descripcion: 'DEFECTO DE LED INDICADOR', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D021', descripcion: 'DEFECTO DE BOTON RESET', codigoRepId: getRepId('N010'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D022', descripcion: 'FALLA DE COMUNICACION DE RF', codigoRepId: getRepId('N013'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D023', descripcion: 'FALLA DE PROCESAMIENTO', codigoRepId: getRepId('N013'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D024', descripcion: 'FALLA DE MEMORIA', codigoRepId: getRepId('N013'), nivelRep: 'N2', scrap: 'NA' },
    { codigo: 'D025', descripcion: 'NO SE ESPECIFICA', codigoRepId: getRepId('N016'), nivelRep: 'N1', scrap: 'NA' },
    { codigo: 'B001', descripcion: 'BASE CON DEFECTO COSMETICO', codigoRepId: getRepId('SC1'), nivelRep: 'NA', scrap: 'SC1' },
    { codigo: 'B002', descripcion: 'BASE CON INFESTACION', codigoRepId: getRepId('SC1'), nivelRep: 'NA', scrap: 'SC1' }
  ];

  for (const codigo of codigosDano) {
    await prisma.codigoDano.upsert({
      where: { codigo: codigo.codigo },
      update: { 
        descripcion: codigo.descripcion,
        codigoRepId: codigo.codigoRepId,
        nivelRep: codigo.nivelRep,
        scrap: codigo.scrap
      },
      create: {
        codigo: codigo.codigo,
        descripcion: codigo.descripcion,
        codigoRepId: codigo.codigoRepId,
        nivelRep: codigo.nivelRep,
        scrap: codigo.scrap
      }
    });
  }
  console.log('Códigos de daño seed completado');

}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });