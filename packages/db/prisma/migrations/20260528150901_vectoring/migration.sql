-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('pending', 'parsing', 'embedding', 'indexed', 'failed');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('pending', 'parsing', 'searching', 'judging', 'done', 'failed');

-- CreateEnum
CREATE TYPE "SuspectStatus" AS ENUM ('pending', 'uploaded', 'failed');

-- CreateEnum
CREATE TYPE "VerdictLabel" AS ENUM ('plagiarism', 'paraphrase', 'no_match');

-- CreateTable
CREATE TABLE "Library" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending',
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIdx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "vector" vector(1024) NOT NULL,
    "model" TEXT NOT NULL,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suspect" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "status" "SuspectStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "suspectId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verdict" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "analysisJobId" TEXT NOT NULL,
    "candidateDocId" TEXT NOT NULL,
    "label" "VerdictLabel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "searchScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePair" (
    "id" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "pairIndex" INTEGER NOT NULL,
    "suspectText" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "EvidencePair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Library_orgId_idx" ON "Library"("orgId");

-- CreateIndex
CREATE INDEX "Document_orgId_libraryId_idx" ON "Document"("orgId", "libraryId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_orgId_contentHash_key" ON "Document"("orgId", "contentHash");

-- CreateIndex
CREATE INDEX "Chunk_orgId_documentId_idx" ON "Chunk"("orgId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_chunkIdx_key" ON "Chunk"("documentId", "chunkIdx");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_orgId_contentHash_key" ON "Chunk"("orgId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_chunkId_key" ON "Embedding"("chunkId");

-- CreateIndex
CREATE INDEX "Embedding_orgId_idx" ON "Embedding"("orgId");

-- CreateIndex
CREATE INDEX "Suspect_orgId_idx" ON "Suspect"("orgId");

-- CreateIndex
CREATE INDEX "AnalysisJob_orgId_idx" ON "AnalysisJob"("orgId");

-- CreateIndex
CREATE INDEX "AnalysisJob_suspectId_idx" ON "AnalysisJob"("suspectId");

-- CreateIndex
CREATE INDEX "Verdict_orgId_analysisJobId_idx" ON "Verdict"("orgId", "analysisJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Verdict_analysisJobId_candidateDocId_key" ON "Verdict"("analysisJobId", "candidateDocId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePair_verdictId_pairIndex_key" ON "EvidencePair"("verdictId", "pairIndex");

-- AddForeignKey
ALTER TABLE "Library" ADD CONSTRAINT "Library_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suspect" ADD CONSTRAINT "Suspect_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_suspectId_fkey" FOREIGN KEY ("suspectId") REFERENCES "Suspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_candidateDocId_fkey" FOREIGN KEY ("candidateDocId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePair" ADD CONSTRAINT "EvidencePair_verdictId_fkey" FOREIGN KEY ("verdictId") REFERENCES "Verdict"("id") ON DELETE CASCADE ON UPDATE CASCADE;
