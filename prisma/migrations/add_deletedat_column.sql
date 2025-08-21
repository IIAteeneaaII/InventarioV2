-- Añadir columna deletedAt a la tabla Modem
ALTER TABLE "Modem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
