// pgvector cosine-distance search — M1 stub returning [].
// Real raw-SQL implementation in M4: orders by `vector <=> $queryEmbedding`,
// filtered by orgId + libraryId, backed by an HNSW index.

export interface VectorSearchHit {
  chunkId: string;
  documentId: string;
  score: number;
}

export async function searchVector(
  _orgId: string,
  _libraryId: string,
  _queryEmbedding: number[],
  _k: number,
): Promise<VectorSearchHit[]> {
  return [];
}
