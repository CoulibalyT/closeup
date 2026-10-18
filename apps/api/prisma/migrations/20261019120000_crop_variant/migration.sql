-- DropIndex
DROP INDEX "Crop_zoomPointId_level_sizePx_key";

-- AlterTable
ALTER TABLE "Crop" ADD COLUMN     "variant" TEXT NOT NULL DEFAULT 'normal';

-- CreateIndex
CREATE UNIQUE INDEX "Crop_zoomPointId_level_sizePx_variant_key" ON "Crop"("zoomPointId", "level", "sizePx", "variant");

