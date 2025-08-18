-- optimizacion.sql
-- Triggers para optimizar la escalabilidad del sistema
-- Versión: 1.0 (2025-08-18)

-- ========== LIMPIEZA DE REGISTROS INTERMEDIOS ==========
-- Este trigger elimina automáticamente los registros intermedios cuando un módem 
-- llega a la fase EMPAQUE, manteniendo solo los registros REGISTRO y EMPAQUE.

CREATE OR REPLACE FUNCTION limpiar_registros_intermedios()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el nuevo registro es de fase EMPAQUE
    IF NEW."fase" = 'EMPAQUE' THEN
        -- Eliminar SOLO registros intermedios, preservando REGISTRO y EMPAQUE
        DELETE FROM "Registro" 
        WHERE "modemId" = NEW."modemId" 
        AND "fase" IN ('TEST_INICIAL', 'ENSAMBLE', 'RETEST')
        AND "id" != NEW."id";
        
        -- Registrar la limpieza
        INSERT INTO "Log" (
            "accion",
            "entidad",
            "detalle",
            "userId",
            "createdAt"
        )
        VALUES (
            'LIMPIEZA_REGISTROS_INTERMEDIOS',
            'Modem',
            'Limpieza automática de registros intermedios para modemId: ' || NEW."modemId",
            NEW."userId",
            NOW()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger para la limpieza automática
DROP TRIGGER IF EXISTS auto_limpiar_registros ON "Registro";
CREATE TRIGGER auto_limpiar_registros
AFTER INSERT ON "Registro"
FOR EACH ROW
EXECUTE FUNCTION limpiar_registros_intermedios();

-- ========== FILTRADO DE LOGS NO IMPORTANTES ==========
-- Este trigger filtra automáticamente los logs menos importantes antes de
-- insertarlos en la base de datos, reduciendo el crecimiento de la tabla Log.

CREATE OR REPLACE FUNCTION filtrar_logs_no_importantes()
RETURNS TRIGGER AS $$
BEGIN
    -- Si es un log de acciones que no son importantes, cancelar la inserción
    IF NEW."accion" IN (
        'CONSULTA', 
        'VISUALIZACIÓN', 
        'NAVEGACIÓN',
        'DEBUG_FASE',
        'TRANSICION_FASE'
    ) THEN
        RETURN NULL; -- No insertar el log
    END IF;
    
    -- Para otros logs, permitir la inserción
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger para filtrar logs
DROP TRIGGER IF EXISTS filtrar_logs ON "Log";
CREATE TRIGGER filtrar_logs
BEFORE INSERT ON "Log"
FOR EACH ROW
EXECUTE FUNCTION filtrar_logs_no_importantes();

-- Añadir comentarios a los triggers para identificarlos fácilmente
COMMENT ON TRIGGER auto_limpiar_registros ON "Registro" IS 'Trigger para eliminar registros intermedios cuando un módem llega a EMPAQUE';
COMMENT ON TRIGGER filtrar_logs ON "Log" IS 'Trigger para filtrar logs de baja importancia';
