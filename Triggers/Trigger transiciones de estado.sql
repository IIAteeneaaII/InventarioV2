-- Función para validar transiciones de estado
CREATE OR REPLACE FUNCTION validar_transicion_estado()
RETURNS TRIGGER AS $$
DECLARE
    v_transicion_valida INTEGER;
    v_roles_permitidos TEXT;
    v_rol_usuario TEXT;
BEGIN
    -- Obtener el rol del usuario responsable
    SELECT u.rol::TEXT INTO v_rol_usuario
    FROM "User" u 
    WHERE u.id = NEW."responsableId";

    -- Permitir cualquier transición si el usuario es UV (superadmin)
    IF v_rol_usuario = 'UV' THEN
        RETURN NEW;
    END IF;

    -- Verificar si la transición está permitida
    SELECT COUNT(*)
    INTO v_transicion_valida
    FROM "TransicionEstado" te
    WHERE 
        te."estadoDesdeId" = OLD."estadoActualId"
        AND te."estadoHaciaId" = NEW."estadoActualId"
        AND (
            te."rolesPermitidos" IS NULL 
            OR te."rolesPermitidos" ~ ('(^|,)' || v_rol_usuario || '(,|$)')
        );

    IF v_transicion_valida = 0 THEN
        RAISE EXCEPTION 'Transición de estado no permitida de % a % para el rol %', 
                        OLD."estadoActualId", NEW."estadoActualId", v_rol_usuario;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para validar transiciones cuando se actualiza un modem
DROP TRIGGER IF EXISTS validar_transicion_modem ON "Modem";
CREATE TRIGGER validar_transicion_modem
BEFORE UPDATE OF "estadoActualId" ON "Modem"
FOR EACH ROW
WHEN (OLD."estadoActualId" IS DISTINCT FROM NEW."estadoActualId")
EXECUTE FUNCTION validar_transicion_estado();

-- Función para registrar automáticamente las transiciones de estado
CREATE OR REPLACE FUNCTION registrar_transicion_estado()
RETURNS TRIGGER AS $$
BEGIN
    RAISE NOTICE 'modemId: %, estadoAnteriorId: %, estadoNuevoId: %, fase: %, evento: %, userId: %',
        NEW.id, OLD."estadoActualId", NEW."estadoActualId", NEW."faseActual", TG_ARGV[0]::TEXT, COALESCE(NEW."responsableId", 1);

    INSERT INTO "EstadoTransicion" (
        "modemId", 
        "estadoAnteriorId", 
        "estadoNuevoId", 
        fase, 
        evento,
        "userId",
        "createdAt"
    )
    VALUES (
        NEW.id,
        OLD."estadoActualId",
        NEW."estadoActualId",
        NEW."faseActual",
        TG_ARGV[0]::TEXT,
        COALESCE(NEW."responsableId", 1),
        NOW()
    );

    -- Actualizar timestamp de última modificación
    NEW."updatedAt" = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para registrar transiciones cuando se actualiza un modem
CREATE TRIGGER registrar_transicion_modem
AFTER UPDATE OF "estadoActualId" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_transicion_estado('actualizacion_estado');