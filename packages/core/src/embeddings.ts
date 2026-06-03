import {
  embed as voyageEmbed,
  VOYAGE_DEFAULT_MODEL,
  VOYAGE_EMBEDDING_DIM,
} from "@repo/llm-clients";

export const EMBED_DIM = VOYAGE_EMBEDDING_DIM;
export const EMBED_MODEL = VOYAGE_DEFAULT_MODEL;

export async function embed(texts: string[]): Promise<number[][]> {
  const { embeddings } = await voyageEmbed(texts, { inputType: "document" });
  return embeddings;
}
