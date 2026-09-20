-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'fr';

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "answerMode" TEXT NOT NULL,
    "scoring" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "nickname" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "roundsSeated" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "bestStreak" INTEGER NOT NULL,
    "answerMsTotal" INTEGER NOT NULL,
    "multiplayer" BOOLEAN NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRound" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "cardId" UUID NOT NULL,
    "seated" INTEGER NOT NULL,
    "found" INTEGER NOT NULL,
    "foundMsTotal" INTEGER NOT NULL,

    CONSTRAINT "GameRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "Game_endedAt_idx" ON "Game"("endedAt");

-- CreateIndex
CREATE INDEX "GameParticipant_playerId_endedAt_idx" ON "GameParticipant"("playerId", "endedAt");

-- CreateIndex
CREATE INDEX "GameParticipant_multiplayer_endedAt_idx" ON "GameParticipant"("multiplayer", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_gameId_playerId_key" ON "GameParticipant"("gameId", "playerId");

-- CreateIndex
CREATE INDEX "GameRound_cardId_idx" ON "GameRound"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "GameRound_gameId_index_key" ON "GameRound"("gameId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Player_userId_key" ON "Player"("userId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRound" ADD CONSTRAINT "GameRound_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

