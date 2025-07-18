-- Función para validar transiciones de fase
CREATE OR REPLACE FUNCTION validar_transicion_fase()
RETURNS TRIGGER AS $$
DECLARE
    v_orden_antiguo INTEGER;
    v_orden_nuevo INTEGER;
BEGIN
    -- Verificar que la transición de fase siga el orden correcto
    -- Obtener orden de las fases
    WITH fase_orden AS (
        SELECT 'REGISTRO' as fase, 1 as orden
        UNION SELECT 'TEST_INICIAL', 2
        UNION SELECT 'COSMETICA', 3
        UNION SELECT 'LIBERACION_LIMPIEZA', 4
        UNION SELECT 'RETEST', 5
        UNION SELECT 'EMPAQUE', 6
    )
    SELECT orden INTO v_orden_antiguo
    FROM fase_orden WHERE fase = OLD."faseActual"::TEXT;
    
    SELECT orden INTO v_orden_nuevo
    FROM fase_orden WHERE fase = NEW."faseActual"::TEXT;
    
    -- Solo permitir avanzar a la siguiente fase o retroceder a fases anteriores para reparación
    IF NEW."estadoActualId" != OLD."estadoActualId" AND v_orden_nuevo < v_orden_antiguo AND 
       (SELECT "codigoInterno" FROM "Estado" WHERE id = NEW."estadoActualId") != 'REPARACION' THEN
        RAISE EXCEPTION 'No se puede retroceder a una fase anterior (de % a %) excepto para reparación', 
                        OLD."faseActual", NEW."faseActual";
    END IF;
    
    -- Si es un avance de más de una fase, verificar que sea válido
    IF v_orden_nuevo > v_orden_antiguo + 1 THEN
        RAISE EXCEPTION 'No se puede saltar fases intermedias (de % a %)', 
                        OLD."faseActual", NEW."faseActual";
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para validar cambios de fase
CREATE TRIGGER validar_cambio_fase
BEFORE UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
WHEN (OLD."faseActual" IS DISTINCT FROM NEW."faseActual")
EXECUTE FUNCTION validar_transicion_fase();

-- Función para registrar transiciones de fase
CREATE OR REPLACE FUNCTION registrar_transicion_fase()
RETURNS TRIGGER AS $$
BEGIN
    -- Insertar registro de transición de fase
    INSERT INTO "TransicionFase" (
        "modemId",
        "faseDesde",
        "faseHacia",
        "userId",
        "createdAt"
    )
    VALUES (
        NEW.id,
        OLD."faseActual",
        NEW."faseActual",
        NEW."responsableId",
        NOW()
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para registrar cambios de fase
CREATE TRIGGER registrar_cambio_fase
AFTER UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_transicion_fase();