// M2 stub: paragraph-split on blank-line boundaries. M3 replaces the body
// with paragraph + sentence-fallback chunking; signature stays stable.

export interface Chunk {
  chunkIdx: number;
  content: string;
}

export function chunk(text: string): Chunk[] {
  return text
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((content, chunkIdx) => ({ chunkIdx, content }));
}
