-- Función para registrar actividades importantes en Log
CREATE OR REPLACE FUNCTION registrar_actividad_log()
RETURNS TRIGGER AS $$
DECLARE
    v_entidad TEXT;
    v_accion TEXT;
    v_detalle TEXT;
BEGIN
    -- Configurar variables según la tabla y operación
    v_entidad := TG_TABLE_NAME;

    IF TG_OP = 'INSERT' THEN
        v_accion := 'CREAR';
        v_detalle := 'Creación de nuevo registro';
    ELSIF TG_OP = 'UPDATE' THEN
        v_accion := 'ACTUALIZAR';
        v_detalle := 'Actualización de registro';
    ELSIF TG_OP = 'DELETE' THEN
        v_accion := 'ELIMINAR';
        v_detalle := 'Eliminación de registro';
    END IF;

    -- Detalles adicionales según la tabla
    IF v_entidad = 'Modem' THEN
        IF TG_OP = 'INSERT' THEN
            v_detalle := 'Registro de nuevo dispositivo con SN: ' || NEW.sn;
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD."estadoActualId" IS DISTINCT FROM NEW."estadoActualId" OR
               OLD."faseActual" IS DISTINCT FROM NEW."faseActual" THEN
                v_detalle := 'Actualización de estado/fase del dispositivo con SN: ' || NEW.sn;
            ELSE
                RETURN NEW;
            END IF;
        ELSIF TG_OP = 'DELETE' THEN
            v_detalle := 'Eliminación del dispositivo con SN: ' || OLD.sn;
        END IF;
    ELSIF v_entidad = 'Lote' THEN
        IF TG_OP = 'INSERT' THEN
            v_detalle := 'Creación de nuevo lote: ' || NEW.numero;
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.estado IS DISTINCT FROM NEW.estado THEN
                v_detalle := 'Actualización de estado del lote: ' || NEW.numero;
            ELSE
                RETURN NEW;
            END IF;
        ELSIF TG_OP = 'DELETE' THEN
            v_detalle := 'Eliminación del lote: ' || OLD.numero;
        END IF;
    END IF;

    -- Insertar registro en Log
    -- INSERT INTO "Log" (
    --     accion,
    --     entidad,
    --     detalle,
    --     "userId",
    --     "createdAt"
    -- )
    -- VALUES (
    --     v_accion,
    --     v_entidad,
    --     v_detalle,
    --     CASE
    --         WHEN v_entidad = 'Registro' THEN COALESCE(NEW."userId", 1)
    --         WHEN v_entidad = 'Modem' THEN COALESCE(NEW."responsableId", OLD."responsableId", 1)
    --         WHEN v_entidad = 'Lote' THEN COALESCE(NEW."responsableId", OLD."responsableId", 1)
    --         ELSE 1
    --     END,
    --     NOW()
    -- );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger para Modem
DROP TRIGGER IF EXISTS log_modem_cambios ON "Modem";
CREATE TRIGGER log_modem_cambios
AFTER INSERT OR UPDATE OR DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();

-- Trigger para Lote
DROP TRIGGER IF EXISTS log_lote_cambios ON "Lote";
CREATE TRIGGER log_lote_cambios
AFTER INSERT OR UPDATE OR DELETE ON "Lote"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();

-- Trigger para Registro
DROP TRIGGER IF EXISTS log_registro_cambios ON "Registro";
CREATE TRIGGER log_registro_cambios
AFTER INSERT ON "Registro"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();