import { requireEnv } from "@repo/config/env";

export const VOYAGE_DEFAULT_MODEL = "voyage-3-large";
export const VOYAGE_EMBEDDING_DIM = 1024;

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_BATCH_LIMIT = 128;
const VOYAGE_API_KEY = requireEnv("VOYAGE_API_KEY");
const VOYAGE_RPM = 3;

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

export type VoyageInputType = "document" | "query";

export interface VoyageEmbedOptions {
  inputType: VoyageInputType;
  model?: string;
}

export interface VoyageEmbedResult {
  embeddings: number[][];
  model: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly burst: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  acquire(): Promise<void> {
    const next = this.chain.then(() => this.consume());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async consume(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    await wait(waitMs);
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

const limiter = new RateLimiter(VOYAGE_RPM, VOYAGE_RPM / 60_000);

interface VoyageEmbeddingDatum {
  embedding: number[];
  index: number;
}

interface VoyageEmbeddingResponse {
  data: VoyageEmbeddingDatum[];
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

async function fetchWithRetry(body: unknown): Promise<VoyageEmbeddingResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await limiter.acquire();

    let res: Response;
    try {
      res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      await wait(BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }

    if (res.ok) {
      return (await res.json()) as VoyageEmbeddingResponse;
    }

    const errText = await res.text().catch(() => "");
    const errMsg = `voyage ${res.status}: ${errText || res.statusText}`;
    lastError = new Error(errMsg);

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) break;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await wait(retryAfter ?? BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }

    if (res.status >= 500) {
      if (attempt === MAX_RETRIES) break;
      await wait(BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }

    throw new Error(errMsg);
  }

  throw new Error(`voyage: retries exhausted: ${String(lastError)}`);
}

async function batchEmbed(
  texts: string[],
  model: string,
  inputType: VoyageInputType,
): Promise<number[][]> {
  const response = await fetchWithRetry({
    input: texts,
    model,
    input_type: inputType,
    output_dimension: VOYAGE_EMBEDDING_DIM,
  });

  const ordered = new Array<number[] | undefined>(texts.length);
  for (const datum of response.data) {
    if (datum.index < 0 || datum.index >= texts.length) {
      throw new Error(`voyage returned out-of-range index ${datum.index}`);
    }
    if (datum.embedding.length !== VOYAGE_EMBEDDING_DIM) {
      throw new Error(
        `voyage returned dim=${datum.embedding.length}, expected ${VOYAGE_EMBEDDING_DIM} — check output_dimension`,
      );
    }
    ordered[datum.index] = datum.embedding;
  }

  for (let i = 0; i < ordered.length; i++) {
    if (!ordered[i]) {
      throw new Error(`voyage response missing embedding for index ${i}`);
    }
  }

  return ordered as number[][];
}

export async function embed(
  texts: string[],
  options: VoyageEmbedOptions,
): Promise<VoyageEmbedResult> {
  const model = options.model ?? VOYAGE_DEFAULT_MODEL;

  if (texts.length === 0) {
    return { embeddings: [], model };
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH_LIMIT) {
    const batch = texts.slice(i, i + VOYAGE_BATCH_LIMIT);
    const result = await batchEmbed(batch, model, options.inputType);
    embeddings.push(...result);
  }

  return { embeddings, model };
}
