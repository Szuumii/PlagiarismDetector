const MAX_CHARS = 2000;
const MIN_CHARS = 40;
const MAX_SENTENCE_CHUNK_CHARS = 1500;

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;
const PARAGRAPH_BOUNDARY = /\n{2,}/;

export interface Chunk {
  chunkIdx: number;
  content: string;
}

function splitLongParagraph(paragraph: string): string[] {
  const sentences = paragraph.split(SENTENCE_BOUNDARY).filter((s) => s.length > 0);
  const merged: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (buffer.length === 0) {
      buffer = sentence;
      continue;
    }
    if (buffer.length + 1 + sentence.length > MAX_SENTENCE_CHUNK_CHARS) {
      merged.push(buffer);
      buffer = sentence;
    } else {
      buffer = `${buffer} ${sentence}`;
    }
  }
  if (buffer.length > 0) merged.push(buffer);
  return merged;
}

export function chunk(text: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const rawParagraph of text.split(PARAGRAPH_BOUNDARY)) {
    const paragraph = rawParagraph.trim();
    if (paragraph.length < MIN_CHARS) continue;

    const pieces =
      paragraph.length <= MAX_CHARS ? [paragraph] : splitLongParagraph(paragraph);

    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (trimmed.length < MIN_CHARS) continue;
      chunks.push({ chunkIdx: chunks.length, content: trimmed });
    }
  }

  return chunks;
}
