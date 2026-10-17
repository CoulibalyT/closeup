-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "bulkImportId" UUID;

-- CreateTable
CREATE TABLE "BulkImport" (
    "id" UUID NOT NULL,
    "queuePrefix" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "skipReasons" JSONB NOT NULL DEFAULT '{}',
    "cursor" JSONB,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkImport_queuePrefix_status_idx" ON "BulkImport"("queuePrefix", "status");

-- CreateIndex
CREATE INDEX "Card_bulkImportId_status_idx" ON "Card"("bulkImportId", "status");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_bulkImportId_fkey" FOREIGN KEY ("bulkImportId") REFERENCES "BulkImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

