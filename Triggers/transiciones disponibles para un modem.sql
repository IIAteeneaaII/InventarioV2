-- Función para obtener las transiciones disponibles para un modem
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
        OR v_rol_usuario = 'UV'
      );
END;
$$ LANGUAGE plpgsql;

-- Función para ejecutar una transición de estado
CREATE OR REPLACE FUNCTION ejecutar_transicion_estado(
    p_modem_id INTEGER,
    p_transicion_id INTEGER,
    p_usuario_id INTEGER,
    p_observaciones TEXT DEFAULT NULL,
    p_cantidad INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_estado_actual_id INTEGER;
    v_estado_destino_id INTEGER;
    v_fase_actual "FaseProceso";
    v_evento TEXT;
    v_requiere_observacion BOOLEAN;
    v_requiere_cantidad BOOLEAN;
BEGIN
    -- Obtener información actual del modem
    SELECT 
        m."estadoActualId", 
        m."faseActual" 
    INTO 
        v_estado_actual_id, 
        v_fase_actual
    FROM "Modem" m 
    WHERE m.id = p_modem_id;
    
    -- Obtener información de la transición
    SELECT 
        te."estadoHaciaId", 
        te."nombreEvento",
        te."requiereObservacion",
        te."requiereCantidad"
    INTO 
        v_estado_destino_id, 
        v_evento,
        v_requiere_observacion,
        v_requiere_cantidad
    FROM "TransicionEstado" te 
    WHERE te.id = p_transicion_id;
    
    -- Validar que la transición corresponde al estado actual
    IF v_estado_actual_id IS NULL OR v_estado_destino_id IS NULL THEN
        RAISE EXCEPTION 'Modem o transición no encontrados';
        RETURN FALSE;
    END IF;
    
    -- Validar si el estado actual corresponde a la transición
    IF NOT EXISTS (
        SELECT 1 FROM "TransicionEstado" 
        WHERE id = p_transicion_id 
        AND "estadoDesdeId" = v_estado_actual_id
    ) THEN
        RAISE EXCEPTION 'La transición seleccionada no es válida para el estado actual';
        RETURN FALSE;
    END IF;
    
    -- Validar campos requeridos
    IF v_requiere_observacion AND p_observaciones IS NULL THEN
        RAISE EXCEPTION 'Esta transición requiere observaciones';
        RETURN FALSE;
    END IF;
    
    IF v_requiere_cantidad AND p_cantidad IS NULL THEN
        RAISE EXCEPTION 'Esta transición requiere especificar cantidad';
        RETURN FALSE;
    END IF;
    
    -- Actualizar el estado del modem
    UPDATE "Modem"
    SET "estadoActualId" = v_estado_destino_id,
        "responsableId" = p_usuario_id,
        "updatedAt" = NOW()
    WHERE id = p_modem_id;
    
    -- Registrar la transición
    INSERT INTO "EstadoTransicion" (
        "modemId",
        "estadoAnteriorId",
        "estadoNuevoId",
        fase,
        evento,
        observaciones,
        cantidad,
        "userId",
        "createdAt"
    )
    VALUES (
        p_modem_id,
        v_estado_actual_id,
        v_estado_destino_id,
        v_fase_actual,
        v_evento,
        p_observaciones,
        p_cantidad,
        p_usuario_id,
        NOW()
    );
    
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;