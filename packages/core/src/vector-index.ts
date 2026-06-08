import { db } from "@repo/db";

import { EMBED_DIM } from "./embeddings";

export interface VectorSearchHit {
  chunkId: string;
  documentId: string;
  score: number;
}

export async function searchVector(
  queryEmbedding: number[],
  k: number,
): Promise<VectorSearchHit[]> {
  if (queryEmbedding.length !== EMBED_DIM) {
    throw new Error(
      `searchVector: queryEmbedding dim=${queryEmbedding.length}, expected ${EMBED_DIM}`,
    );
  }

  const literal = `[${queryEmbedding.join(",")}]`;

  return db.$queryRaw<VectorSearchHit[]>`
    SELECT c.id AS "chunkId",
           c."documentId",
           1 - (e.vector <=> ${literal}::vector) AS score
    FROM "Embedding" e
    JOIN "Chunk" c    ON c.id = e."chunkId"
    JOIN "Document" d ON d.id = c."documentId"
    WHERE d.status = 'indexed'
    ORDER BY e.vector <=> ${literal}::vector
    LIMIT ${k}
  `;
}
