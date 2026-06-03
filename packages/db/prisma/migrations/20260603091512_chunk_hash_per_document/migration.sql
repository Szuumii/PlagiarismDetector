/*
  Warnings:

  - A unique constraint covering the columns `[documentId,contentHash]` on the table `Chunk` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Chunk_contentHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_contentHash_key" ON "Chunk"("documentId", "contentHash");
