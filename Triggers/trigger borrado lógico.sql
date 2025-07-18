-- Función para manejar borrado lógico de modems
CREATE OR REPLACE FUNCTION borrado_logico_modem()
RETURNS TRIGGER AS $$
BEGIN
    -- En lugar de eliminar, marcar como eliminado
    IF TG_OP = 'DELETE' THEN
        UPDATE "Modem"
        SET "deletedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = OLD.id;
        
        -- Registrar la acción en el log
        INSERT INTO "Log" (
            accion,
            entidad,
            detalle,
            "userId",
            "createdAt"
        )
        VALUES (
            'ELIMINAR_LOGICO',
            'Modem',
            'Eliminación lógica del modem con SN: ' || OLD.sn,
            1, -- Usuario sistema o se podría usar una variable de sesión
            NOW()
        );
        
        RETURN NULL; -- No elimina realmente el registro
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para manejar borrado lógico de modems
DROP TRIGGER IF EXISTS borrado_logico_modem_trigger ON "Modem";
CREATE TRIGGER borrado_logico_modem_trigger
BEFORE DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION borrado_logico_modem();

-- Función para manejar borrado lógico de LoteSku
CREATE OR REPLACE FUNCTION borrado_logico_lotesku()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE "LoteSku"
        SET "deletedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = OLD.id;
        INSERT INTO "Log" (
            accion,
            entidad,
            detalle,
            "userId",
            "createdAt"
        )
        VALUES (
            'ELIMINAR_LOGICO',
            'LoteSku',
            'Eliminación lógica del loteSku: ' || OLD.numero,
            1,
            NOW()
        );
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para manejar borrado lógico de LoteSku
DROP TRIGGER IF EXISTS borrado_logico_lotesku_trigger ON "LoteSku";
CREATE TRIGGER borrado_logico_lotesku_trigger
BEFORE DELETE ON "LoteSku"
FOR EACH ROW
EXECUTE FUNCTION borrado_logico_lotesku();