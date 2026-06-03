import {
  embed as mistralEmbed,
  MISTRAL_DEFAULT_MODEL,
  MISTRAL_EMBEDDING_DIM,
} from "@repo/llm-clients";

export const EMBED_DIM = MISTRAL_EMBEDDING_DIM;
export const EMBED_MODEL = MISTRAL_DEFAULT_MODEL;

export async function embed(texts: string[]): Promise<number[][]> {
  const { embeddings } = await mistralEmbed(texts);
  return embeddings;
}
