/*
  Warnings:

  - You are about to drop the column `contentHash` on the `Chunk` table. All the data in the column will be lost.
  - You are about to drop the column `contentHash` on the `Document` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Chunk_documentId_contentHash_key";

-- AlterTable
ALTER TABLE "Chunk" DROP COLUMN "contentHash";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "contentHash";
