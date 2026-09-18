-- CreateEnum
CREATE TYPE "PackVisibility" AS ENUM ('PRIVATE', 'PENDING_REVIEW', 'PUBLIC', 'DISABLED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('CELEBRITY', 'CHARACTER', 'OBJECT', 'ANIMAL', 'LANDMARK', 'FOOD', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('DRAFT', 'PROCESSING', 'NEEDS_POINTS', 'READY', 'LIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CardSource" AS ENUM ('SEED', 'UPLOAD', 'WIKIMEDIA');

-- CreateEnum
CREATE TYPE "ZoomPointOrigin" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "Pack" (
    "id" UUID NOT NULL,
    "slug" TEXT,
    "titleFr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "descriptionFr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "visibility" "PackVisibility" NOT NULL DEFAULT 'PRIVATE',
    "publicMatchSafe" BOOLEAN NOT NULL DEFAULT false,
    "category" "Category" NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "slug" TEXT,
    "category" "Category" NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "status" "CardStatus" NOT NULL DEFAULT 'DRAFT',
    "isPerson" BOOLEAN NOT NULL DEFAULT false,
    "source" "CardSource" NOT NULL,
    "creditAuthor" TEXT,
    "creditLicence" TEXT,
    "creditSourceUrl" TEXT,
    "imageId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAnswer" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "aliases" TEXT[],

    CONSTRAINT "CardAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" UUID NOT NULL,
    "originalKey" TEXT NOT NULL,
    "revealKey" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoomPoint" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "baseRadius" DOUBLE PRECISION NOT NULL,
    "labelFr" TEXT,
    "labelEn" TEXT,
    "origin" "ZoomPointOrigin" NOT NULL DEFAULT 'MANUAL',
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ZoomPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crop" (
    "id" UUID NOT NULL,
    "zoomPointId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "sizePx" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "focusX" DOUBLE PRECISION NOT NULL,
    "focusY" DOUBLE PRECISION NOT NULL,
    "scaleFromPrev" DOUBLE PRECISION,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "Crop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloBest" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "configKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoloBest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pack_slug_key" ON "Pack"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Card_imageId_key" ON "Card"("imageId");

-- CreateIndex
CREATE INDEX "Card_status_category_difficulty_idx" ON "Card"("status", "category", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "Card_packId_slug_key" ON "Card"("packId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CardAnswer_cardId_locale_key" ON "CardAnswer"("cardId", "locale");

-- CreateIndex
CREATE INDEX "ZoomPoint_cardId_idx" ON "ZoomPoint"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "Crop_zoomPointId_level_sizePx_key" ON "Crop"("zoomPointId", "level", "sizePx");

-- CreateIndex
CREATE UNIQUE INDEX "SoloBest_playerId_configKey_key" ON "SoloBest"("playerId", "configKey");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ImageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAnswer" ADD CONSTRAINT "CardAnswer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoomPoint" ADD CONSTRAINT "ZoomPoint_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crop" ADD CONSTRAINT "Crop_zoomPointId_fkey" FOREIGN KEY ("zoomPointId") REFERENCES "ZoomPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloBest" ADD CONSTRAINT "SoloBest_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
