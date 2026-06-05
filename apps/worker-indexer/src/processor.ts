import { chunk, embed, EMBED_MODEL, extractText } from "@repo/core";
import { db } from "@repo/db";
import { IndexDocumentJobSchema, type IndexDocumentJob } from "@repo/schemas";
import { storage } from "@repo/storage";
import type { Job } from "bullmq";

export async function processIndexDocument(
  job: Job<IndexDocumentJob>,
): Promise<void> {
  const { documentId, objectKey } = IndexDocumentJobSchema.parse(job.data);

  console.log(`[indexer] start documentId=${documentId}`);

  await db.document.update({
    where: { id: documentId },
    data: { status: "parsing" },
  });

  const buffer = await storage.getObject(objectKey);
  const text = await extractText(buffer);
  const textChunks = chunk(text);

  const persistedChunks = [];
  for (const c of textChunks) {
    const persisted = await db.chunk.upsert({
      where: { documentId_chunkIdx: { documentId, chunkIdx: c.chunkIdx } },
      create: {
        documentId,
        chunkIdx: c.chunkIdx,
        content: c.content,
      },
      update: {
        content: c.content,
      },
    });
    persistedChunks.push(persisted);
  }

  await db.document.update({
    where: { id: documentId },
    data: { status: "embedding" },
  });

  const existingEmbeddings = await db.embedding.findMany({
    where: { chunk: { documentId } },
    select: { chunkId: true },
  });
  const embeddedChunkIds = new Set(existingEmbeddings.map((e) => e.chunkId));
  const needEmbedding = persistedChunks.filter(
    (c) => !embeddedChunkIds.has(c.id),
  );

  if (needEmbedding.length === 0) {
    console.log(`[indexer] all chunks already embedded, skipping Mistral`);
  } else {
    console.log(
      `[indexer] embedding ${needEmbedding.length} chunks via Mistral`,
    );
    const vectors = await embed(needEmbedding.map((c) => c.content));

    for (let i = 0; i < needEmbedding.length; i++) {
      const chunkRow = needEmbedding[i];
      const vector = vectors[i];
      const vectorLiteral = `[${vector.join(",")}]`;

      await db.$executeRaw`
        INSERT INTO "Embedding" (id, "chunkId", vector, model)
        VALUES (gen_random_uuid(), ${chunkRow.id}, ${vectorLiteral}::vector, ${EMBED_MODEL})
        ON CONFLICT ("chunkId") DO UPDATE
          SET vector = EXCLUDED.vector, model = EXCLUDED.model
      `;
    }
  }

  await db.document.update({
    where: { id: documentId },
    data: { status: "indexed" },
  });

  console.log(
    `[indexer] done documentId=${documentId} chunks=${persistedChunks.length}`,
  );
}
