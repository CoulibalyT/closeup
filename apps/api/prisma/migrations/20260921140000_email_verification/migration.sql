-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- AlterTable
ALTER TABLE "PasswordReset" ADD COLUMN     "kind" "LinkKind" NOT NULL DEFAULT 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

