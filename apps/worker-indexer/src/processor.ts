import { chunk, embed, EMBED_MODEL, extractText } from "@repo/core";
import { db } from "@repo/db";
import { IndexDocumentJobSchema, type IndexDocumentJob } from "@repo/schemas";
import type { Job } from "bullmq";

import { getObjectBody } from "./s3";

export async function processIndexDocument(
  job: Job<IndexDocumentJob>,
): Promise<void> {
  const { documentId, objectKey } = IndexDocumentJobSchema.parse(job.data);

  console.log(`[indexer] start documentId=${documentId}`);

  await db.document.update({
    where: { id: documentId },
    data: { status: "parsing" },
  });

  const buffer = await getObjectBody(objectKey);
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
        contentHash: `fake-${documentId}-${c.chunkIdx}`,
      },
      update: {
        content: c.content,
        contentHash: `fake-${documentId}-${c.chunkIdx}`,
      },
    });
    persistedChunks.push(persisted);
  }

  await db.document.update({
    where: { id: documentId },
    data: { status: "embedding" },
  });

  const vectors = await embed(textChunks.map((c) => c.content));

  for (let i = 0; i < persistedChunks.length; i++) {
    const chunkRow = persistedChunks[i];
    const vector = vectors[i];
    const vectorLiteral = `[${vector.join(",")}]`;

    await db.$executeRaw`
      INSERT INTO "Embedding" (id, "chunkId", vector, model)
      VALUES (gen_random_uuid(), ${chunkRow.id}, ${vectorLiteral}::vector, ${EMBED_MODEL})
      ON CONFLICT ("chunkId") DO UPDATE
        SET vector = EXCLUDED.vector, model = EXCLUDED.model
    `;
  }

  await db.document.update({
    where: { id: documentId },
    data: { status: "indexed" },
  });

  console.log(
    `[indexer] done documentId=${documentId} chunks=${persistedChunks.length}`,
  );
}
