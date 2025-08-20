-- Migración para implementar triggers del sistema
-- Creado el 20 de agosto de 2025

-- Asegurar lenguaje PL/pgSQL
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- ===================== LIMPIEZA PREVIA DE TRIGGERS EXISTENTES =====================
DROP TRIGGER IF EXISTS log_modem_cambios            ON "Modem";
DROP TRIGGER IF EXISTS log_lote_cambios             ON "Lote";
DROP TRIGGER IF EXISTS log_registro_cambios         ON "Registro";
DROP TRIGGER IF EXISTS actualizar_lote_desde_modem  ON "Modem";
DROP TRIGGER IF EXISTS borrado_logico_modem_trigger ON "Modem";
DROP TRIGGER IF EXISTS validar_transicion_modem     ON "Modem";
DROP TRIGGER IF EXISTS registrar_transicion_modem   ON "Modem";
DROP TRIGGER IF EXISTS validar_cambio_fase          ON "Modem";
DROP TRIGGER IF EXISTS registrar_cambio_fase        ON "Modem";
DROP TRIGGER IF EXISTS validar_fase_inicial_modem   ON "Modem";

-- ===================== 1) VALIDAR FASE INICIAL EN INSERT =================
CREATE OR REPLACE FUNCTION validar_fase_inicial()
RETURNS TRIGGER AS $$
DECLARE
    v_rol_usuario   TEXT;
    v_fase_permitida TEXT;
BEGIN
    SELECT rol::TEXT INTO v_rol_usuario FROM "User" WHERE id = NEW."responsableId";

    CASE v_rol_usuario
        WHEN 'UReg' THEN v_fase_permitida := 'REGISTRO';
        WHEN 'UA'   THEN v_fase_permitida := NULL; -- UA puede usar cualquier fase
        ELSE v_fase_permitida := 'REGISTRO';
    END CASE;
    
    IF v_rol_usuario = 'UA' THEN
        RETURN NEW;
    END IF;
    
    IF v_fase_permitida IS NOT NULL AND NEW."faseActual" <> v_fase_permitida THEN
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('ERROR_VALIDACION', 'MODEM', 
               format('El usuario con rol %s intentó crear un modem en fase %s (permitida: %s)', 
                      v_rol_usuario, NEW."faseActual", v_fase_permitida),
               NEW."responsableId", now());
        RAISE EXCEPTION 'El usuario con rol % solo puede crear modems en fase %', 
                        v_rol_usuario, v_fase_permitida;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validar_fase_inicial_modem
BEFORE INSERT ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION validar_fase_inicial();

-- ===================== 2) VALIDAR CAMBIOS DE FASE =================
CREATE OR REPLACE FUNCTION validar_cambio_fase()
RETURNS TRIGGER AS $$
DECLARE
    v_rol_usuario TEXT;
    v_fases_permitidas TEXT[];
    v_fase_actual TEXT;
    v_fase_nueva TEXT;
    v_mensaje TEXT;
BEGIN
    -- Si no es un cambio de fase, permitir
    IF OLD."faseActual" = NEW."faseActual" THEN
        RETURN NEW;
    END IF;

    v_fase_actual := OLD."faseActual"::TEXT;
    v_fase_nueva := NEW."faseActual"::TEXT;
    
    -- Obtener rol del usuario responsable
    SELECT rol::TEXT INTO v_rol_usuario FROM "User" WHERE id = NEW."responsableId";
    
    -- El rol UA puede hacer cualquier cambio
    IF v_rol_usuario = 'UA' THEN
        RETURN NEW;
    END IF;
    
    -- Determinar fases permitidas según el rol
    CASE v_rol_usuario
        WHEN 'UReg' THEN 
            v_fases_permitidas := ARRAY['REGISTRO'];
        WHEN 'UTI' THEN 
            v_fases_permitidas := ARRAY['TEST_INICIAL'];
        WHEN 'UC' THEN 
            v_fases_permitidas := ARRAY['COSMETICA'];
        WHEN 'UEN' THEN 
            v_fases_permitidas := ARRAY['ENSAMBLE'];
        WHEN 'UR' THEN 
            v_fases_permitidas := ARRAY['RETEST'];
        WHEN 'UE' THEN 
            v_fases_permitidas := ARRAY['EMPAQUE', 'SCRAP'];
        ELSE
            v_fases_permitidas := ARRAY['REGISTRO'];
    END CASE;
    
    -- Validar si la nueva fase está permitida para el rol
    IF NOT (v_fase_nueva = ANY(v_fases_permitidas)) THEN
        v_mensaje := format('El usuario con rol %s no puede cambiar a fase %s. Fases permitidas: %s', 
                           v_rol_usuario, v_fase_nueva, array_to_string(v_fases_permitidas, ', '));
        
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('ERROR_VALIDACION', 'MODEM', v_mensaje, NEW."responsableId", now());
        
        RAISE EXCEPTION '%', v_mensaje;
    END IF;
    
    -- Validar transiciones específicas según la fase actual
    IF v_fase_actual = 'REGISTRO' AND NOT (v_fase_nueva IN ('TEST_INICIAL', 'SCRAP')) THEN
        RAISE EXCEPTION 'Desde REGISTRO sólo se puede pasar a TEST_INICIAL o SCRAP';
    ELSIF v_fase_actual = 'TEST_INICIAL' AND NOT (v_fase_nueva IN ('COSMETICA', 'ENSAMBLE', 'SCRAP')) THEN
        RAISE EXCEPTION 'Desde TEST_INICIAL sólo se puede pasar a COSMETICA, ENSAMBLE o SCRAP';
    ELSIF v_fase_actual = 'COSMETICA' AND NOT (v_fase_nueva IN ('ENSAMBLE', 'SCRAP')) THEN
        RAISE EXCEPTION 'Desde COSMETICA sólo se puede pasar a ENSAMBLE o SCRAP';
    ELSIF v_fase_actual = 'ENSAMBLE' AND NOT (v_fase_nueva IN ('RETEST', 'SCRAP')) THEN
        RAISE EXCEPTION 'Desde ENSAMBLE sólo se puede pasar a RETEST o SCRAP';
    ELSIF v_fase_actual = 'RETEST' AND NOT (v_fase_nueva IN ('EMPAQUE', 'ENSAMBLE', 'SCRAP')) THEN
        RAISE EXCEPTION 'Desde RETEST sólo se puede pasar a EMPAQUE, ENSAMBLE o SCRAP';
    ELSIF v_fase_actual = 'EMPAQUE' AND v_fase_nueva <> 'SCRAP' THEN
        RAISE EXCEPTION 'Desde EMPAQUE sólo se puede pasar a SCRAP';
    ELSIF v_fase_actual = 'SCRAP' THEN
        RAISE EXCEPTION 'No se puede cambiar desde la fase SCRAP';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validar_cambio_fase
BEFORE UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION validar_cambio_fase();

-- ===================== 3) REGISTRAR CAMBIOS DE FASE =================
CREATE OR REPLACE FUNCTION registrar_cambio_fase()
RETURNS TRIGGER AS $$
BEGIN
    -- Si hubo un cambio de fase, registrarlo
    IF OLD."faseActual" <> NEW."faseActual" THEN
        INSERT INTO "HistoricoFases"("modemId", "faseAnterior", "faseNueva", "responsableId", "createdAt")
        VALUES(NEW.id, OLD."faseActual", NEW."faseActual", NEW."responsableId", now());
        
        -- Registrar en log
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('CAMBIO_FASE', 'MODEM', 
              format('Modem id:%s cambió de fase %s a %s', 
                     NEW.id, OLD."faseActual", NEW."faseActual"),
              NEW."responsableId", now());
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER registrar_cambio_fase
AFTER UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_cambio_fase();

-- ===================== 4) ACTUALIZAR LOTE DESDE MODEM =================
CREATE OR REPLACE FUNCTION actualizar_lote_desde_modem()
RETURNS TRIGGER AS $$
DECLARE
    v_lote_id INTEGER;
BEGIN
    -- Si cambia la fase o estado, actualizar contadores del lote
    IF (OLD."faseActual" <> NEW."faseActual") OR (OLD."estadoActualId" <> NEW."estadoActualId") THEN
        SELECT "loteId" INTO v_lote_id FROM "Registro" WHERE "modemId" = NEW.id;
        
        IF v_lote_id IS NOT NULL THEN
            -- Actualizar contadores del lote
            UPDATE "Lote" 
            SET "cantidadActualizada" = now(),
                "contadorRegistro" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'REGISTRO'),
                "contadorTestInicial" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'TEST_INICIAL'),
                "contadorCosmetica" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'COSMETICA'),
                "contadorEnsamble" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'ENSAMBLE'),
                "contadorRetest" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'RETEST'),
                "contadorEmpaque" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'EMPAQUE'),
                "contadorScrap" = (SELECT COUNT(*) FROM "Modem" m JOIN "Registro" r ON m.id = r."modemId" WHERE r."loteId" = v_lote_id AND m."faseActual" = 'SCRAP')
            WHERE id = v_lote_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actualizar_lote_desde_modem
AFTER UPDATE OF "faseActual", "estadoActualId" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION actualizar_lote_desde_modem();

-- ===================== 5) BORRADO LÓGICO DE MODEM =================
CREATE OR REPLACE FUNCTION borrado_logico_modem()
RETURNS TRIGGER AS $$
DECLARE
    v_estado_eliminado_id INTEGER;
BEGIN
    -- Obtener ID del estado ELIMINADO
    SELECT id INTO v_estado_eliminado_id FROM "Estado" WHERE codigoInterno = 'ELIMINADO' LIMIT 1;
    
    -- En lugar de eliminar físicamente, marcar como eliminado
    UPDATE "Modem" 
    SET "deletedAt" = now(),
        "updatedAt" = now(),
        "estadoActualId" = COALESCE(v_estado_eliminado_id, "estadoActualId")
    WHERE id = OLD.id;
    
    -- Registrar en log
    INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
    VALUES('BORRADO_LOGICO', 'MODEM', 
           format('Borrado lógico del modem id:%s, serie:%s', OLD.id, OLD.sn),
           OLD."responsableId", now());
    
    -- Prevenir el borrado físico
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER borrado_logico_modem_trigger
BEFORE DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION borrado_logico_modem();

-- ===================== 6) LOGS DE CAMBIOS EN MODEM =================
CREATE OR REPLACE FUNCTION log_modem_cambios()
RETURNS TRIGGER AS $$
DECLARE
    cambios_texto TEXT := '';
    old_estado_nombre TEXT;
    new_estado_nombre TEXT;
BEGIN
    -- Obtener nombres de los estados
    SELECT nombre INTO old_estado_nombre FROM "Estado" WHERE id = OLD."estadoActualId";
    SELECT nombre INTO new_estado_nombre FROM "Estado" WHERE id = NEW."estadoActualId";
    
    -- Crear texto detallando los cambios
    IF OLD.sn <> NEW.sn THEN
        cambios_texto := cambios_texto || format('Número serie: %s → %s; ', OLD.sn, NEW.sn);
    END IF;
    
    IF OLD."faseActual" <> NEW."faseActual" THEN
        cambios_texto := cambios_texto || format('Fase: %s → %s; ', OLD."faseActual", NEW."faseActual");
    END IF;
    
    IF OLD."estadoActualId" <> NEW."estadoActualId" THEN
        cambios_texto := cambios_texto || format('Estado: %s → %s; ', old_estado_nombre, new_estado_nombre);
    END IF;
    
    IF OLD."responsableId" <> NEW."responsableId" THEN
        cambios_texto := cambios_texto || format('Responsable: %s → %s; ', OLD."responsableId", NEW."responsableId");
    END IF;
    
    -- Si hay cambios, registrarlos en el log
    IF cambios_texto <> '' THEN
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('ACTUALIZAR', 'MODEM', 
               format('Modem id:%s - %s', NEW.id, cambios_texto),
               NEW."responsableId", now());
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_modem_cambios
AFTER UPDATE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION log_modem_cambios();

-- ===================== 7) LOGS DE CAMBIOS EN LOTE =================
CREATE OR REPLACE FUNCTION log_lote_cambios()
RETURNS TRIGGER AS $$
DECLARE
    cambios_texto TEXT := '';
    responsable_id INTEGER;
BEGIN
    -- Determinar el responsable
    responsable_id := COALESCE(NEW."responsableId", 1); -- Default a ID 1 si no hay responsable
    
    -- Crear texto detallando los cambios
    IF OLD.nombre <> NEW.nombre THEN
        cambios_texto := cambios_texto || format('Nombre: %s → %s; ', OLD.nombre, NEW.nombre);
    END IF;
    
    IF OLD.estado <> NEW.estado THEN
        cambios_texto := cambios_texto || format('Estado: %s → %s; ', OLD.estado, NEW.estado);
    END IF;
    
    -- Si hay cambios, registrarlos en el log
    IF cambios_texto <> '' THEN
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('ACTUALIZAR', 'LOTE', 
               format('Lote id:%s - %s', NEW.id, cambios_texto),
               responsable_id, now());
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_lote_cambios
AFTER UPDATE ON "Lote"
FOR EACH ROW
EXECUTE FUNCTION log_lote_cambios();

-- ===================== 8) LOGS DE CAMBIOS EN REGISTRO =================
CREATE OR REPLACE FUNCTION log_registro_cambios()
RETURNS TRIGGER AS $$
DECLARE
    cambios_texto TEXT := '';
    responsable_id INTEGER;
BEGIN
    -- Determinar el responsable
    responsable_id := COALESCE(NEW."responsableId", 1); -- Default a ID 1 si no hay responsable
    
    -- Crear texto detallando los cambios
    IF OLD."loteId" <> NEW."loteId" THEN
        cambios_texto := cambios_texto || format('Lote ID: %s → %s; ', OLD."loteId", NEW."loteId");
    END IF;
    
    IF OLD."modemId" <> NEW."modemId" THEN
        cambios_texto := cambios_texto || format('Modem ID: %s → %s; ', OLD."modemId", NEW."modemId");
    END IF;
    
    IF OLD.estado <> NEW.estado THEN
        cambios_texto := cambios_texto || format('Estado: %s → %s; ', OLD.estado, NEW.estado);
    END IF;
    
    -- Si hay cambios, registrarlos en el log
    IF cambios_texto <> '' THEN
        INSERT INTO "Log"(accion, entidad, detalle, "userId", "createdAt")
        VALUES('ACTUALIZAR', 'REGISTRO', 
               format('Registro id:%s - %s', NEW.id, cambios_texto),
               responsable_id, now());
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_registro_cambios
AFTER UPDATE ON "Registro"
FOR EACH ROW
EXECUTE FUNCTION log_registro_cambios();
