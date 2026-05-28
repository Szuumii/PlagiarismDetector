// Voyage embeddings client — M1 stub. Real implementation in M3.
// The signature is the production shape so the indexer can wire against
// it now and the swap to real Voyage calls is a no-op for callers.

export const VOYAGE_DEFAULT_MODEL = "voyage-3-large";
export const VOYAGE_EMBEDDING_DIM = 1024;

export type VoyageInputType = "document" | "query";

export interface VoyageEmbedOptions {
  inputType: VoyageInputType;
  model?: string;
}

export interface VoyageEmbedResult {
  embeddings: number[][];
  model: string;
}

export async function embed(
  texts: string[],
  options: VoyageEmbedOptions,
): Promise<VoyageEmbedResult> {
  const model = options.model ?? VOYAGE_DEFAULT_MODEL;
  return {
    model,
    embeddings: texts.map(() => new Array<number>(VOYAGE_EMBEDDING_DIM).fill(0)),
  };
}
