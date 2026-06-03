import { requireEnv } from "@repo/config/env";

export const MISTRAL_DEFAULT_MODEL = "mistral-embed";
export const MISTRAL_EMBEDDING_DIM = 1024;

const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";
const MISTRAL_BATCH_LIMIT = 128;
const MISTRAL_API_KEY = requireEnv("MISTRAL_API_KEY");

const MAX_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const SERVER_ERROR_BACKOFF_MS = 1_000;

// inputType kept for ABI compatibility with the voyage client signature;
// mistral-embed doesn't distinguish document vs query embeddings.
export type MistralInputType = "document" | "query";

export interface MistralEmbedOptions {
  inputType?: MistralInputType;
  model?: string;
}

export interface MistralEmbedResult {
  embeddings: number[][];
  model: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MistralEmbeddingDatum {
  embedding: number[];
  index: number;
}

interface MistralEmbeddingResponse {
  data: MistralEmbeddingDatum[];
  model: string;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

async function fetchWithRetry(
  body: unknown,
): Promise<MistralEmbeddingResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const requestStart = Date.now();
    console.log(
      `[mistral:fetch] attempt ${attempt + 1}/${MAX_RETRIES + 1} firing`,
    );

    let res: Response;
    try {
      res = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = err;
      console.log(
        `[mistral:fetch] network error after ${Date.now() - requestStart}ms: ${String(err)}`,
      );
      if (attempt === MAX_RETRIES) break;
      const backoff = SERVER_ERROR_BACKOFF_MS * 2 ** attempt;
      console.log(`[mistral:fetch] backing off ${backoff}ms before retry`);
      await wait(backoff);
      continue;
    }

    const elapsed = Date.now() - requestStart;
    console.log(`[mistral:fetch] status=${res.status} elapsed=${elapsed}ms`);

    if (res.ok) {
      return (await res.json()) as MistralEmbeddingResponse;
    }

    const errText = await res.text().catch(() => "");
    const errMsg = `mistral ${res.status}: ${errText || res.statusText}`;
    lastError = new Error(errMsg);

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfter = parseRetryAfter(retryAfterRaw);
      const backoff = retryAfter ?? RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
      console.log(`[mistral:fetch] 429 body: ${errText || "(empty)"}`);
      console.log(
        `[mistral:fetch] Retry-After: ${retryAfterRaw ?? "(none)"}, backoff ${backoff}ms`,
      );
      if (attempt === MAX_RETRIES) break;
      await wait(backoff);
      continue;
    }

    if (res.status >= 500) {
      const backoff = SERVER_ERROR_BACKOFF_MS * 2 ** attempt;
      console.log(
        `[mistral:fetch] ${res.status} body: ${errText || "(empty)"}, backoff ${backoff}ms`,
      );
      if (attempt === MAX_RETRIES) break;
      await wait(backoff);
      continue;
    }

    console.log(
      `[mistral:fetch] ${res.status} (non-retryable) body: ${errText || "(empty)"}`,
    );
    throw new Error(errMsg);
  }

  throw new Error(`mistral: retries exhausted: ${String(lastError)}`);
}

async function batchEmbed(texts: string[], model: string): Promise<number[][]> {
  const response = await fetchWithRetry({
    model,
    input: texts,
  });

  const ordered = new Array<number[] | undefined>(texts.length);
  for (const datum of response.data) {
    if (datum.index < 0 || datum.index >= texts.length) {
      throw new Error(`mistral returned out-of-range index ${datum.index}`);
    }
    if (datum.embedding.length !== MISTRAL_EMBEDDING_DIM) {
      throw new Error(
        `mistral returned dim=${datum.embedding.length}, expected ${MISTRAL_EMBEDDING_DIM}`,
      );
    }
    ordered[datum.index] = datum.embedding;
  }

  for (let i = 0; i < ordered.length; i++) {
    if (!ordered[i]) {
      throw new Error(`mistral response missing embedding for index ${i}`);
    }
  }

  return ordered as number[][];
}

export async function embed(
  texts: string[],
  options: MistralEmbedOptions = {},
): Promise<MistralEmbedResult> {
  const model = options.model ?? MISTRAL_DEFAULT_MODEL;

  if (texts.length === 0) {
    return { embeddings: [], model };
  }

  const embeddings: number[][] = [];
  const totalBatches = Math.ceil(texts.length / MISTRAL_BATCH_LIMIT);
  for (let i = 0; i < texts.length; i += MISTRAL_BATCH_LIMIT) {
    const batch = texts.slice(i, i + MISTRAL_BATCH_LIMIT);
    const batchIdx = Math.floor(i / MISTRAL_BATCH_LIMIT) + 1;
    const remainingAfter = texts.length - (i + batch.length);
    console.log(
      `[mistral] batch ${batchIdx}/${totalBatches}: ${batch.length} chunks (${remainingAfter} remaining)`,
    );
    const result = await batchEmbed(batch, model);
    embeddings.push(...result);
  }

  return { embeddings, model };
}
