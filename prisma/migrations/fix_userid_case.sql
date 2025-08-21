-- Script para corregir el problema de sincronización userid/userId
ALTER TABLE "Registro" RENAME COLUMN "userId" TO "userId_temp";
ALTER TABLE "Registro" ADD COLUMN "userId" INTEGER;
UPDATE "Registro" SET "userId" = "userId_temp";
ALTER TABLE "Registro" DROP COLUMN "userId_temp";
