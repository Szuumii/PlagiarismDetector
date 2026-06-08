import { db } from "@repo/db";
import MiniSearch from "minisearch";

export interface BM25Hit {
  chunkId: string;
  documentId: string;
  score: number;
}

interface IndexedChunkDoc {
  id: string;
  content: string;
  documentId: string;
}

let cachedIndex: MiniSearch<IndexedChunkDoc> | null = null;
let pendingRebuild: Promise<void> | null = null;

function buildIndex(chunks: IndexedChunkDoc[]): MiniSearch<IndexedChunkDoc> {
  const index = new MiniSearch<IndexedChunkDoc>({
    fields: ["content"],
    storeFields: ["documentId"],
  });
  index.addAll(chunks);
  return index;
}

export async function rebuildBM25Index(): Promise<void> {
  if (pendingRebuild) return pendingRebuild;

  pendingRebuild = (async () => {
    try {
      const chunks = await db.chunk.findMany({
        where: { document: { status: "indexed" } },
        select: { id: true, content: true, documentId: true },
      });
      cachedIndex = buildIndex(chunks);
    } finally {
      pendingRebuild = null;
    }
  })();

  return pendingRebuild;
}

export async function bm25Search(query: string, k: number): Promise<BM25Hit[]> {
  if (!cachedIndex) await rebuildBM25Index();
  if (!cachedIndex) return []; // rebuild returned no chunks → empty corpus

  const results = cachedIndex.search(query);
  return results.slice(0, k).map((r) => ({
    chunkId: r.id as string,
    documentId: (r as unknown as { documentId: string }).documentId,
    score: r.score,
  }));
}
