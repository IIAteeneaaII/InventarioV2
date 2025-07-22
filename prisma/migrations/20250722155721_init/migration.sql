/*
  Warnings:

  - You are about to drop the column `motivoScrapId` on the `Registro` table. All the data in the column will be lost.
  - You are about to drop the `EstadoTransicion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MotivoScrap` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TransicionFase` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `skuId` on table `Modem` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "MotivoScrap" AS ENUM ('DEFECTO_HW', 'DEFECTO_SW', 'SIN_REPARACION', 'OTRO');

-- DropForeignKey
ALTER TABLE "EstadoTransicion" DROP CONSTRAINT "EstadoTransicion_estadoAnteriorId_fkey";

-- DropForeignKey
ALTER TABLE "EstadoTransicion" DROP CONSTRAINT "EstadoTransicion_estadoNuevoId_fkey";

-- DropForeignKey
ALTER TABLE "EstadoTransicion" DROP CONSTRAINT "EstadoTransicion_modemId_fkey";

-- DropForeignKey
ALTER TABLE "EstadoTransicion" DROP CONSTRAINT "EstadoTransicion_userId_fkey";

-- DropForeignKey
ALTER TABLE "Modem" DROP CONSTRAINT "Modem_skuId_fkey";

-- DropForeignKey
ALTER TABLE "Registro" DROP CONSTRAINT "Registro_motivoScrapId_fkey";

-- DropForeignKey
ALTER TABLE "TransicionFase" DROP CONSTRAINT "TransicionFase_modemId_fkey";

-- DropForeignKey
ALTER TABLE "TransicionFase" DROP CONSTRAINT "TransicionFase_userId_fkey";

-- AlterTable
ALTER TABLE "CatalogoSKU" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "CatalogoSKU_id_seq";

-- AlterTable
ALTER TABLE "Modem" ADD COLUMN     "motivoScrap" "MotivoScrap",
ALTER COLUMN "skuId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Registro" DROP COLUMN "motivoScrapId",
ADD COLUMN     "motivoScrap" "MotivoScrap";

-- DropTable
DROP TABLE "EstadoTransicion";

-- DropTable
DROP TABLE "MotivoScrap";

-- DropTable
DROP TABLE "TransicionFase";

-- CreateTable
CREATE TABLE "VistaPorSKU" (
    "id" SERIAL NOT NULL,
    "skuId" INTEGER NOT NULL,
    "rol" "Rol" NOT NULL,
    "vista" TEXT NOT NULL,

    CONSTRAINT "VistaPorSKU_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VistaPorSKU_skuId_rol_key" ON "VistaPorSKU"("skuId", "rol");

-- AddForeignKey
ALTER TABLE "VistaPorSKU" ADD CONSTRAINT "VistaPorSKU_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "CatalogoSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modem" ADD CONSTRAINT "Modem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "CatalogoSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
