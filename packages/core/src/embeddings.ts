// M2 stub: returns a constant zero vector per input. M3 swaps this for the
// real Voyage call ("voyage-3-large", input_type: "document", batched).
//
// The dim must match the Embedding.vector column (vector(1024)) — a mismatch
// throws at insert time. Real embeddings will assert length === EMBED_DIM
// before insert; the fake bakes the dim in.

export const EMBED_DIM = 1024;
export const EMBED_MODEL = "fake-m2-zero";

export async function embed(texts: string[]): Promise<number[][]> {
  return texts.map(() => new Array<number>(EMBED_DIM).fill(0));
}
