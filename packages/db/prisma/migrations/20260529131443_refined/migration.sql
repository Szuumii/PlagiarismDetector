/*
  Warnings:

  - You are about to drop the column `orgId` on the `Chunk` table. All the data in the column will be lost.
  - You are about to drop the column `libraryId` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `orgId` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `orgId` on the `Embedding` table. All the data in the column will be lost.
  - You are about to drop the `Library` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[contentHash]` on the table `Chunk` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contentHash]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Chunk" DROP CONSTRAINT "Chunk_orgId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_orgId_fkey";

-- DropForeignKey
ALTER TABLE "Embedding" DROP CONSTRAINT "Embedding_orgId_fkey";

-- DropForeignKey
ALTER TABLE "Library" DROP CONSTRAINT "Library_orgId_fkey";

-- DropIndex
DROP INDEX "Chunk_orgId_contentHash_key";

-- DropIndex
DROP INDEX "Chunk_orgId_documentId_idx";

-- DropIndex
DROP INDEX "Document_orgId_contentHash_key";

-- DropIndex
DROP INDEX "Document_orgId_libraryId_idx";

-- DropIndex
DROP INDEX "Embedding_orgId_idx";

-- AlterTable
ALTER TABLE "Chunk" DROP COLUMN "orgId";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "libraryId",
DROP COLUMN "orgId";

-- AlterTable
ALTER TABLE "Embedding" DROP COLUMN "orgId";

-- DropTable
DROP TABLE "Library";

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_contentHash_key" ON "Chunk"("contentHash");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_contentHash_key" ON "Document"("contentHash");
