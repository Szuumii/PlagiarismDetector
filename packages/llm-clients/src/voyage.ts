import { requireEnv } from "@repo/config/env";

export const VOYAGE_DEFAULT_MODEL = "voyage-3-large";
export const VOYAGE_EMBEDDING_DIM = 1024;

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_BATCH_LIMIT = 128;
const VOYAGE_API_KEY = requireEnv("VOYAGE_API_KEY");
// Voyage's tier limit is 3 RPM (20s exactly). Pace at 30s to leave headroom
// for clock skew, network jitter, and any other processes sharing the key.
const VOYAGE_CALL_INTERVAL_MS = 30_000;

const MAX_RETRIES = 2;
// Voyage enforces 3 RPM on a strict 60s rolling window. A 429 means we have to
// wait long enough for an in-window call to age out — short exponential backoff
// (sub-second) just burns retry budget against the same closed window.
const RATE_LIMIT_BACKOFF_MS = 30_000;
const SERVER_ERROR_BACKOFF_MS = 1_000;

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
      console.log(
        `[voyage:limiter] token acquired (remaining=${this.tokens.toFixed(2)})`,
      );
      return;
    }

    const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    console.log(
      `[voyage:limiter] waiting ${waitMs}ms for token (current=${this.tokens.toFixed(2)})`,
    );
    await wait(waitMs);
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

// burst=1 means no initial burst; first call instant, every subsequent call
// waits VOYAGE_CALL_INTERVAL_MS. refillPerMs = 1 / interval so that one token
// regenerates over exactly that interval.
const limiter = new RateLimiter(1, 1 / VOYAGE_CALL_INTERVAL_MS);

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

    const requestStart = Date.now();
    console.log(
      `[voyage:fetch] attempt ${attempt + 1}/${MAX_RETRIES + 1} firing`,
    );

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
      console.log(
        `[voyage:fetch] network error after ${Date.now() - requestStart}ms: ${String(err)}`,
      );
      if (attempt === MAX_RETRIES) break;
      const backoff = SERVER_ERROR_BACKOFF_MS * 2 ** attempt;
      console.log(`[voyage:fetch] backing off ${backoff}ms before retry`);
      await wait(backoff);
      continue;
    }

    const elapsed = Date.now() - requestStart;
    console.log(`[voyage:fetch] status=${res.status} elapsed=${elapsed}ms`);

    if (res.ok) {
      return (await res.json()) as VoyageEmbeddingResponse;
    }

    const errText = await res.text().catch(() => "");
    const errMsg = `voyage ${res.status}: ${errText || res.statusText}`;
    lastError = new Error(errMsg);

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfter = parseRetryAfter(retryAfterRaw);
      const backoff = retryAfter ?? RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
      console.log(`[voyage:fetch] 429 body: ${errText || "(empty)"}`);
      console.log(
        `[voyage:fetch] Retry-After header: ${retryAfterRaw ?? "(none)"}, applying ${backoff}ms backoff`,
      );
      if (attempt === MAX_RETRIES) break;
      await wait(backoff);
      continue;
    }

    if (res.status >= 500) {
      const backoff = SERVER_ERROR_BACKOFF_MS * 2 ** attempt;
      console.log(
        `[voyage:fetch] ${res.status} body: ${errText || "(empty)"}, backing off ${backoff}ms`,
      );
      if (attempt === MAX_RETRIES) break;
      await wait(backoff);
      continue;
    }

    console.log(
      `[voyage:fetch] ${res.status} (non-retryable) body: ${errText || "(empty)"}`,
    );
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
  const totalBatches = Math.ceil(texts.length / VOYAGE_BATCH_LIMIT);
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH_LIMIT) {
    const batch = texts.slice(i, i + VOYAGE_BATCH_LIMIT);
    const batchIdx = Math.floor(i / VOYAGE_BATCH_LIMIT) + 1;
    const remainingAfter = texts.length - (i + batch.length);
    console.log(
      `[voyage] batch ${batchIdx}/${totalBatches}: ${batch.length} chunks (${remainingAfter} remaining)`,
    );
    const result = await batchEmbed(batch, model, options.inputType);
    embeddings.push(...result);
  }

  return { embeddings, model };
}
