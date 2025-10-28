-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "spaceId" TEXT;

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spaces_userId_idx" ON "spaces"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_userId_name_key" ON "spaces"("userId", "name");

-- CreateIndex
CREATE INDEX "conversations_spaceId_idx" ON "conversations"("spaceId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
