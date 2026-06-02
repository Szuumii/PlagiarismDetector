// M2 stub: ignores suspectText and returns the first k indexed Documents
// with a synthetic descending score. M4 replaces the body with parallel
// vector + BM25 + RRF fusion; signature stays stable.

import { db } from "@repo/db";

export interface SearchHit {
  documentId: string;
  score: number;
}

export async function hybridSearch(
  _suspectText: string,
  k: number,
): Promise<SearchHit[]> {
  const documents = await db.document.findMany({
    where: { status: "indexed" },
    take: k,
    select: { id: true },
  });
  return documents.map((doc, i) => ({
    documentId: doc.id,
    score: 1 - i * 0.05,
  }));
}
