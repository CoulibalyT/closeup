-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- AlterTable
ALTER TABLE "Card" ADD COLUMN "gender" "Gender";
