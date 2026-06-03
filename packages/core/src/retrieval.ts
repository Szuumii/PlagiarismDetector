import { bm25Search } from "./bm25";
import { embed } from "./embeddings";
import { searchVector } from "./vector-index";

export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  score: number;
}

const RRF_K = 60;
const CANDIDATE_MULTIPLIER = 3;

interface RankedHit {
  chunkId: string;
  documentId: string;
}

function rrfFuse(lists: RankedHit[][], k: number): RetrievalHit[] {
  const scores = new Map<string, RetrievalHit>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const hit = list[i];
      const contribution = 1 / (RRF_K + i + 1);
      const existing = scores.get(hit.chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(hit.chunkId, {
          chunkId: hit.chunkId,
          documentId: hit.documentId,
          score: contribution,
        });
      }
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function hybridSearch(
  query: string,
  k: number,
): Promise<RetrievalHit[]> {
  const [queryEmbedding] = await embed([query]);
  const candidateK = k * CANDIDATE_MULTIPLIER;

  const [vector, lexical] = await Promise.all([
    searchVector(queryEmbedding, candidateK),
    bm25Search(query, candidateK),
  ]);

  return rrfFuse([vector, lexical], k);
}
