-- 1. Función para registrar actividades importantes en Log
CREATE OR REPLACE FUNCTION registrar_actividad_log()
RETURNS TRIGGER AS $$
DECLARE
    v_entidad TEXT;
    v_accion TEXT;
    v_detalle TEXT;
    v_user_id INTEGER;
BEGIN
    v_entidad := TG_TABLE_NAME;

    IF TG_OP = 'INSERT' THEN
        v_accion := 'CREAR';
        v_detalle := 'Creación de nuevo registro';
        
        -- Asignación de userId según la entidad (usando referencias correctas)
        IF v_entidad = 'Modem' THEN
            v_user_id := COALESCE(NEW."responsableId", 1);
        ELSIF v_entidad = 'Lote' THEN
            v_user_id := COALESCE(NEW."responsableId", 1);
        ELSIF v_entidad = 'Registro' THEN
            v_user_id := COALESCE(NEW."userId", 1);
        ELSE
            v_user_id := 1;
        END IF;
        
    ELSIF TG_OP = 'UPDATE' THEN
        v_accion := 'ACTUALIZAR';
        v_detalle := 'Actualización de registro';
        
        -- Asignación de userId según la entidad
        IF v_entidad = 'Modem' THEN
            v_user_id := COALESCE(NEW."responsableId", OLD."responsableId", 1);
        ELSIF v_entidad = 'Lote' THEN
            v_user_id := COALESCE(NEW."responsableId", OLD."responsableId", 1);
        ELSE
            v_user_id := 1;
        END IF;
        
    ELSIF TG_OP = 'DELETE' THEN
        v_accion := 'ELIMINAR';
        v_detalle := 'Eliminación de registro';
        
        -- Asignación de userId según la entidad
        IF v_entidad = 'Modem' THEN
            v_user_id := COALESCE(OLD."responsableId", 1);
        ELSIF v_entidad = 'Lote' THEN
            v_user_id := COALESCE(OLD."responsableId", 1);
        ELSE
            v_user_id := 1;
        END IF;
    END IF;

    -- Detalles específicos según la entidad
    IF v_entidad = 'Modem' THEN
        IF TG_OP = 'INSERT' THEN
            v_detalle := 'Registro de nuevo dispositivo con SN: ' || NEW.sn;
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD."estadoActualId" IS DISTINCT FROM NEW."estadoActualId"
               OR OLD."faseActual" IS DISTINCT FROM NEW."faseActual" THEN
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
    ELSIF v_entidad = 'Registro' THEN
        IF TG_OP = 'INSERT' THEN
            v_detalle := 'Registro de nueva acción de fase SN: ' || NEW.sn || ', fase: ' || NEW.fase;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    -- Insertar el registro de log con el userId calculado
    INSERT INTO "Log" (
        accion,
        entidad,
        detalle,
        "userId",
        "createdAt"
    )
    VALUES (
        v_accion,
        v_entidad,
        v_detalle,
        v_user_id,
        NOW()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Triggers para registrar_actividad_log
CREATE TRIGGER log_modem_cambios
AFTER INSERT OR UPDATE OR DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();

CREATE TRIGGER log_lote_cambios
AFTER INSERT OR UPDATE OR DELETE ON "Lote"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();

CREATE TRIGGER log_registro_cambios
AFTER INSERT ON "Registro"
FOR EACH ROW
EXECUTE FUNCTION registrar_actividad_log();

-- 2. Función para actualizar automáticamente el estado de un Lote
CREATE OR REPLACE FUNCTION actualizar_estado_lote()
RETURNS TRIGGER AS $$
DECLARE
    v_total_modems      INTEGER;
    v_modems_completados INTEGER;
    v_modems_cancelados  INTEGER;
    v_modems_pausados   INTEGER;
    v_lote_id           INTEGER;
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        v_lote_id := NEW."loteId";
    ELSE
        v_lote_id := OLD."loteId";
    END IF;

    SELECT 
        COUNT(*),
        SUM(CASE WHEN e."codigoInterno" = 'COMPLETADO' THEN 1 ELSE 0 END),
        SUM(CASE WHEN e."codigoInterno" = 'SCRAP' THEN 1 ELSE 0 END),
        SUM(CASE WHEN e."codigoInterno" = 'PAUSADO' THEN 1 ELSE 0 END)
    INTO
        v_total_modems, v_modems_completados, v_modems_cancelados, v_modems_pausados
    FROM 
        "Modem" m
        JOIN "Estado" e ON m."estadoActualId" = e.id
    WHERE
        m."loteId" = v_lote_id
        AND m."deletedAt" IS NULL;

    IF v_total_modems = 0 THEN
        RETURN NEW;
    ELSIF v_modems_completados + v_modems_cancelados = v_total_modems THEN
        UPDATE "Lote" SET estado = 'COMPLETADO', "updatedAt" = NOW() WHERE id = v_lote_id;
    ELSIF v_modems_pausados > 0 THEN
        UPDATE "Lote" SET estado = 'PAUSADO',    "updatedAt" = NOW() WHERE id = v_lote_id;
    ELSE
        UPDATE "Lote" SET estado = 'EN_PROCESO', "updatedAt" = NOW() WHERE id = v_lote_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actualizar_lote_desde_modem
AFTER INSERT OR UPDATE OF "estadoActualId" OR DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION actualizar_estado_lote();

-- 3. Funciones y triggers de borrado lógico
CREATE OR REPLACE FUNCTION borrado_logico_modem()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE "Modem" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = OLD.id;
        INSERT INTO "Log"(accion,entidad,detalle,"userId","createdAt")
        VALUES (
          'ELIMINAR_LOGICO',
          'Modem',
          'Eliminación lógica del modem con SN: ' || OLD.sn,
          1,
          NOW()
        );
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER borrado_logico_modem_trigger
BEFORE DELETE ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION borrado_logico_modem();

-- 4. Validación de transiciones de estado en Modem
CREATE OR REPLACE FUNCTION validar_transicion_estado()
RETURNS TRIGGER AS $$
DECLARE
    v_rol_usuario TEXT;
    v_count       INTEGER;
BEGIN
    SELECT rol::TEXT INTO v_rol_usuario FROM "User" WHERE id = NEW."responsableId";
    IF v_rol_usuario = 'UV' THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM "TransicionEstado" te
    WHERE te."estadoDesdeId" = OLD."estadoActualId"
      AND te."estadoHaciaId"  = NEW."estadoActualId"
      AND (
        te."rolesPermitidos" IS NULL
        OR te."rolesPermitidos" ~ ('(^|,)' || v_rol_usuario || '(,|$)')
      );

    IF v_count = 0 THEN
        RAISE EXCEPTION 'Transición no permitida de % a % para rol %',
            OLD."estadoActualId", NEW."estadoActualId", v_rol_usuario;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validar_transicion_modem
BEFORE UPDATE OF "estadoActualId" ON "Modem"
FOR EACH ROW
WHEN (OLD."estadoActualId" IS DISTINCT FROM NEW."estadoActualId")
EXECUTE FUNCTION validar_transicion_estado();

-- Modificado para usar Log en lugar de EstadoTransicion
CREATE OR REPLACE FUNCTION registrar_transicion_estado()
RETURNS TRIGGER AS $$
BEGIN
    -- Usar la tabla Log existente en lugar de EstadoTransicion
    INSERT INTO "Log"(
      accion,
      entidad,
      detalle,
      "userId",
      "createdAt"
    ) VALUES (
      'TRANSICION_ESTADO',
      'Modem',
      'Cambio de estado: ' || OLD."estadoActualId" || ' -> ' || NEW."estadoActualId" || ' para modem SN: ' || NEW.sn,
      COALESCE(NEW."responsableId", 1),
      NOW()
    );
    NEW."updatedAt" := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER registrar_transicion_modem
AFTER UPDATE OF "estadoActualId" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_transicion_estado();

-- 5. Validación de transiciones de fase en Modem
CREATE OR REPLACE FUNCTION validar_transicion_fase()
RETURNS TRIGGER AS $$
DECLARE
    v_orden_ant INTEGER;
    v_orden_nuevo INTEGER; -- CORREGIDO: Nombre de variable cambiado
BEGIN
    -- Definimos el orden de fases según schema.prisma
    WITH fase_order AS (
      SELECT 'REGISTRO'      AS fase, 1 UNION
      SELECT 'TEST_INICIAL'  AS fase, 2 UNION
      SELECT 'ENSAMBLE'      AS fase, 3 UNION
      SELECT 'RETEST'        AS fase, 4 UNION
      SELECT 'EMPAQUE'       AS fase, 5 UNION
      SELECT 'SCRAP'         AS fase, 6 UNION
      SELECT 'REPARACION'    AS fase, 7
    )
    SELECT fo.orden INTO v_orden_ant
    FROM fase_order fo
    WHERE fo.fase = OLD."faseActual";

    SELECT fo.orden INTO v_orden_nuevo -- CORREGIDO: Nombre de variable cambiado
    FROM fase_order fo
    WHERE fo.fase = NEW."faseActual";

    -- No retroceder salvo a Reparación y no saltar fases
    IF v_orden_nuevo < v_orden_ant -- CORREGIDO: Nombre de variable cambiado
       AND (SELECT "codigoInterno" FROM "Estado" WHERE id = NEW."estadoActualId") != 'REPARACION'
    THEN
        RAISE EXCEPTION 'No se puede retroceder de fase % a %', OLD."faseActual", NEW."faseActual";
    ELSIF v_orden_nuevo > v_orden_ant + 1 THEN -- CORREGIDO: Nombre de variable cambiado
        RAISE EXCEPTION 'No se puede saltar de fase % a %', OLD."faseActual", NEW."faseActual";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validar_cambio_fase
BEFORE UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
WHEN (OLD."faseActual" IS DISTINCT FROM NEW."faseActual")
EXECUTE FUNCTION validar_transicion_fase();

-- Modificado para usar Log en lugar de TransicionFase
CREATE OR REPLACE FUNCTION registrar_transicion_fase()
RETURNS TRIGGER AS $$
BEGIN
    -- Usar la tabla Log existente en lugar de TransicionFase
    INSERT INTO "Log"(
      accion,
      entidad,
      detalle,
      "userId",
      "createdAt"
    ) VALUES (
      'TRANSICION_FASE',
      'Modem',
      'Cambio de fase: ' || OLD."faseActual" || ' -> ' || NEW."faseActual" || ' para modem SN: ' || NEW.sn,
      NEW."responsableId",
      NOW()
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER registrar_cambio_fase
AFTER UPDATE OF "faseActual" ON "Modem"
FOR EACH ROW
EXECUTE FUNCTION registrar_transicion_fase();