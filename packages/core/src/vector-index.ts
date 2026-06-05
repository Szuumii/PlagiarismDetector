// pgvector cosine-distance search — M1 stub returning [].
// Real raw-SQL implementation in M4: orders by `vector <=> $queryEmbedding`,
// unfiltered (library side is global — single shared corpus), backed by an
// HNSW index.

export interface VectorSearchHit {
  chunkId: string;
  documentId: string;
  score: number;
}

export async function searchVector(
  _queryEmbedding: number[],
  _k: number,
): Promise<VectorSearchHit[]> {
  return [];
}
