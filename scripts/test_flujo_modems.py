import psycopg2
import random
from datetime import datetime
import time

# Configuración de la base de datos
DB_CONFIG = {
    "dbname": "simod_db",
    "user": "simod_user",
    "password": "simod_pass",
    "host": "localhost",
    "port": 5432
}

def obtener_skus(cur):
    """Obtener todos los SKUs disponibles con su cantidad de módems"""
    cur.execute("""
        SELECT s.id, s.nombre, COUNT(m.id) AS cantidad
        FROM "CatalogoSKU" s
        LEFT JOIN "Modem" m ON m."skuId" = s.id
        GROUP BY s.id, s.nombre
        ORDER BY s.id
    """)
    return cur.fetchall()

def crear_lote(cur, sku_id, responsable_id, estado='EN_PROCESO'):
    """Crea un nuevo lote en la base de datos para un SKU específico"""
    # Agregar timestamp y número aleatorio para evitar duplicados
    numero = f"L{int(time.time())}-{sku_id}-{random.randint(1000, 9999)}"
    # Esperar un poco para evitar colisiones en la generación de números
    time.sleep(0.01)
    cur.execute("""
        INSERT INTO "Lote" (numero, "skuId", estado, "responsableId", "createdAt", "updatedAt")
        VALUES (%s, %s, %s, %s, NOW(), NOW())
        RETURNING id, numero, estado
    """, (numero, sku_id, estado, responsable_id))
    return cur.fetchone()

def redistribuir_modems_entre_skus(cur, conn, sku_origen_id, sku_destinos, responsable_id, proporciones=None):
    """
    Redistribuye los módems de un SKU origen entre varios SKUs destino.
    
    Args:
        cur: Cursor de base de datos
        conn: Conexión a base de datos
        sku_origen_id: ID del SKU de origen
        sku_destinos: Lista de IDs de SKUs destino
        responsable_id: ID del usuario responsable
        proporciones: Lista de porcentajes para cada SKU destino (opcional)
    """
    # Verificar SKU origen
    cur.execute("""
        SELECT nombre, (SELECT COUNT(*) FROM "Modem" WHERE "skuId" = %s)
        FROM "CatalogoSKU" 
        WHERE id = %s
    """, (sku_origen_id, sku_origen_id))
    
    origen_info = cur.fetchone()
    if not origen_info:
        print(f"No se encontró el SKU origen con ID {sku_origen_id}")
        return
    
    sku_origen_nombre, total_modems = origen_info
    
    if total_modems == 0:
        print(f"El SKU origen {sku_origen_nombre} no tiene módems para redistribuir.")
        return
    
    print(f"\n=== REDISTRIBUCIÓN DE MÓDEMS ENTRE SKUs ===")
    print(f"SKU origen: {sku_origen_nombre} (ID: {sku_origen_id}) con {total_modems} módems")
    print(f"SKUs destino: {len(sku_destinos)} SKUs")
    
    # Calcular cuántos módems van a cada SKU destino
    if proporciones:
        # Normalizar proporciones si no suman 100
        total_proporcion = sum(proporciones)
        if total_proporcion != 100:
            factor = 100 / total_proporcion
            proporciones = [p * factor for p in proporciones]
        
        # Calcular cantidad de módems por SKU destino
        cantidades = [int((p / 100) * total_modems) for p in proporciones]
        
        # Ajustar para asegurarnos que se asignen todos los módems
        diferencia = total_modems - sum(cantidades)
        for i in range(diferencia):
            cantidades[i % len(cantidades)] += 1
    else:
        # Distribución equitativa
        modems_por_sku = total_modems // len(sku_destinos)
        modems_extra = total_modems % len(sku_destinos)
        
        cantidades = [modems_por_sku for _ in sku_destinos]
        for i in range(modems_extra):
            cantidades[i] += 1
    
    # Obtener todos los módems del SKU origen
    cur.execute("""
        SELECT id, "estadoActualId"
        FROM "Modem"
        WHERE "skuId" = %s
    """, (sku_origen_id,))
    
    modems = cur.fetchall()
    
    # Mezclar aleatoriamente los módems
    random.shuffle(modems)
    
    # Crear lotes para cada SKU destino
    lotes_creados = []
    
    for idx, sku_id in enumerate(sku_destinos):
        # Obtener nombre del SKU destino
        cur.execute('SELECT nombre FROM "CatalogoSKU" WHERE id = %s', (sku_id,))
        sku_nombre = cur.fetchone()[0]
        
        # Crear un lote para este SKU
        lote = crear_lote(cur, sku_id, responsable_id, 'EN_PROCESO')
        lote_id, lote_numero, _ = lote
        
        print(f"\nProcesando SKU destino: {sku_nombre} (ID: {sku_id})")
        print(f"  ✓ Lote creado: {lote_numero} (ID: {lote_id})")
        print(f"  ✓ Asignando {cantidades[idx]} módems")
        
        # Tomar la cantidad correspondiente de módems
        inicio = sum(cantidades[:idx])
        fin = inicio + cantidades[idx]
        modems_a_mover = modems[inicio:fin]
        
        # Mover estos módems al nuevo SKU y lote
        for modem_id, estado_id in modems_a_mover:
            cur.execute("""
                UPDATE "Modem"
                SET "skuId" = %s, "loteId" = %s, "responsableId" = %s, "updatedAt" = NOW()
                WHERE id = %s
            """, (sku_id, lote_id, responsable_id, modem_id))
        
        lotes_creados.append((lote_id, lote_numero, sku_nombre, len(modems_a_mover)))
    
    conn.commit()
    
    # Mostrar resumen
    print("\n=== RESUMEN DE REDISTRIBUCIÓN ===")
    print(f"Total de módems redistribuidos: {total_modems}")
    print(f"Total de lotes creados: {len(lotes_creados)}")
    
    for lote_id, lote_numero, sku_nombre, count in lotes_creados:
        print(f"Lote {lote_numero} (ID: {lote_id}): {count} módems asignados a {sku_nombre}")
    
    print("\n✅ Redistribución completada con éxito")

def verificar_distribucion_por_sku(cur):
    """Muestra un informe detallado de la distribución de módems por SKU"""
    print("\n=== VERIFICACIÓN DE DISTRIBUCIÓN POR SKU ===")
    
    cur.execute("""
        SELECT s.id, s.nombre, COUNT(m.id) as total_modems,
               string_agg(DISTINCT e.nombre || ' (' || COUNT(m.id) OVER (PARTITION BY s.id, e.nombre) || ')', ', ') as estados
        FROM "CatalogoSKU" s
        LEFT JOIN "Modem" m ON m."skuId" = s.id
        LEFT JOIN "Estado" e ON m."estadoActualId" = e.id
        GROUP BY s.id, s.nombre
        ORDER BY s.id
    """)
    
    skus = cur.fetchall()
    
    for sku_id, sku_nombre, total, estados in skus:
        if total > 0:
            print(f"SKU {sku_id}: {sku_nombre} - {total} módems")
            if estados:
                print(f"  Estados: {estados}")
        else:
            print(f"SKU {sku_id}: {sku_nombre} - Sin módems")

def main():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    while True:
        print("\n===== REDISTRIBUCIÓN DE MÓDEMS ENTRE SKUs =====")
        print("1. Verificar SKUs disponibles")
        print("2. Redistribuir módems de un SKU a todos los demás")
        print("3. Redistribuir módems de un SKU a SKUs específicos")
        print("4. Verificar distribución por SKU")
        print("5. Salir")
        
        opcion = input("\nSeleccione una opción: ").strip()
        
        if opcion == "1":
            # Mostrar SKUs
            skus = obtener_skus(cur)
            print("\n=== SKUs Disponibles ===")
            for i, (sku_id, sku_nombre, cantidad) in enumerate(skus):
                print(f"{i+1}. {sku_nombre} (ID: {sku_id}): {cantidad} módems")
        
        elif opcion == "2":
            # Redistribuir a todos los demás
            skus = obtener_skus(cur)
            
            print("\n=== SKUs Disponibles ===")
            for i, (sku_id, sku_nombre, cantidad) in enumerate(skus):
                print(f"{i+1}. {sku_nombre} (ID: {sku_id}): {cantidad} módems")
            
            # Seleccionar SKU origen
            origen_idx = int(input("\nSeleccione el SKU origen (número): ")) - 1
            if origen_idx < 0 or origen_idx >= len(skus):
                print("Selección inválida.")
                continue
            
            sku_origen_id = skus[origen_idx][0]
            
            # Determinar SKUs destino (todos excepto el origen)
            sku_destinos = [sku[0] for sku in skus if sku[0] != sku_origen_id]
            
            # Seleccionar responsable
            print("\n=== Usuarios Disponibles ===")
            cur.execute('SELECT id, nombre, "userName", rol FROM "User"')
            usuarios = cur.fetchall()
            for i, (id, nombre, username, rol) in enumerate(usuarios):
                print(f"{i+1}. {nombre} ({username}) - {rol}")
            
            usuario_idx = int(input("\nSeleccione un usuario responsable (número): ")) - 1
            if usuario_idx < 0 or usuario_idx >= len(usuarios):
                print("Selección inválida.")
                continue
            
            responsable_id = usuarios[usuario_idx][0]
            
            # Ejecutar redistribución
            redistribuir_modems_entre_skus(cur, conn, sku_origen_id, sku_destinos, responsable_id)
        
        elif opcion == "3":
            # Redistribuir a SKUs específicos
            skus = obtener_skus(cur)
            
            print("\n=== SKUs Disponibles ===")
            for i, (sku_id, sku_nombre, cantidad) in enumerate(skus):
                print(f"{i+1}. {sku_nombre} (ID: {sku_id}): {cantidad} módems")
            
            # Seleccionar SKU origen
            origen_idx = int(input("\nSeleccione el SKU origen (número): ")) - 1
            if origen_idx < 0 or origen_idx >= len(skus):
                print("Selección inválida.")
                continue
            
            sku_origen_id = skus[origen_idx][0]
            
            # Seleccionar SKUs destino
            print("\nSeleccione los SKUs destino (números separados por comas):")
            destinos_input = input().strip()
            destinos_idx = [int(idx.strip()) - 1 for idx in destinos_input.split(",")]
            
            sku_destinos = []
            for idx in destinos_idx:
                if idx < 0 or idx >= len(skus) or skus[idx][0] == sku_origen_id:
                    print(f"Ignorando selección inválida: {idx+1}")
                    continue
                sku_destinos.append(skus[idx][0])
            
            if not sku_destinos:
                print("No se seleccionaron SKUs destino válidos.")
                continue
            
            # Seleccionar responsable
            print("\n=== Usuarios Disponibles ===")
            cur.execute('SELECT id, nombre, "userName", rol FROM "User"')
            usuarios = cur.fetchall()
            for i, (id, nombre, username, rol) in enumerate(usuarios):
                print(f"{i+1}. {nombre} ({username}) - {rol}")
            
            usuario_idx = int(input("\nSeleccione un usuario responsable (número): ")) - 1
            if usuario_idx < 0 or usuario_idx >= len(usuarios):
                print("Selección inválida.")
                continue
            
            responsable_id = usuarios[usuario_idx][0]
            
            # Preguntar si quiere especificar proporciones
            usar_proporciones = input("\n¿Desea especificar proporciones para la distribución? (s/n): ").lower() == 's'
            
            proporciones = None
            if usar_proporciones:
                proporciones = []
                print("\nIngrese la proporción (%) para cada SKU destino:")
                for idx, sku_id in enumerate(sku_destinos):
                    sku_nombre = next((sku[1] for sku in skus if sku[0] == sku_id), "Desconocido")
                    prop = float(input(f"Proporción para {sku_nombre} (ID: {sku_id}): "))
                    proporciones.append(prop)
            
            # Ejecutar redistribución
            redistribuir_modems_entre_skus(cur, conn, sku_origen_id, sku_destinos, responsable_id, proporciones)
        
        elif opcion == "4":
            # Verificar distribución
            verificar_distribucion_por_sku(cur)
        
        elif opcion == "5":
            break
        
        else:
            print("Opción inválida.")
    
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()