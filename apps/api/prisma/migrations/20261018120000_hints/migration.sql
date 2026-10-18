-- AlterTable
ALTER TABLE "CardAnswer" ADD COLUMN     "hint" TEXT,
ADD COLUMN     "secondary" TEXT[] DEFAULT ARRAY[]::TEXT[];

