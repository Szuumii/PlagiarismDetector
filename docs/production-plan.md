# Production TypeScript Implementation Plan

## Context

The Jupyter prototype (`prototype.ipynb`) proves out a four-stage pipeline — chunk → embed → hybrid retrieve → LLM-as-judge — for detecting plagiarism in academic PDFs. It works end-to-end but cannot be a product: single-user, single-machine, blocking execution, in-process state, no UI beyond a static HTML file.

This plan describes how to migrate that pipeline into a production TypeScript stack with multiple servers, an async message queue, object storage, and a browser-based upload/results UI. The Python notebook stays as the research/eval environment (where iterating on chunking strategies, embedding models, and judge prompts is cheap). The TypeScript stack becomes the production runtime.

## Target architecture (north star)

See [`architecture.excalidraw`](./architecture.excalidraw) for the diagram (open with Excalidraw web app or the Excalidraw VS Code extension). Quick ASCII reference:

```
   Browser runs the React SPA (static Vite build — served from CDN or @fastify/static)
                              │
                              │ tRPC + SSE over HTTPS
                      ┌───────▼──────┐         ┌─────────────────────┐
                      │  API server  │────────▶│  Outbound API       │
                      │  (Fastify +  │         │  rate-limit gateway │──▶ Voyage / Anthropic
                      │   tRPC)      │         │  (Phase 4)          │
                      └───┬──────────┘         └─────────────────────┘
                          │                              ▲
                  enqueue │                              │
                          ▼                              │
                      ┌──────────────┐                   │
                      │  Redis +     │                   │
                      │  BullMQ      │                   │
                      └─┬──────────┬─┘                   │
                        │          │                     │
              ┌─────────▼──┐   ┌───▼────────┐            │
              │ worker-    │   │ worker-    │────────────┘
              │ indexer    │   │ analyzer   │
              └─────┬──────┘   └─────┬──────┘
                    │                │
                ┌───▼────────────────▼───┐    ┌─────────────┐
                │  Postgres + pgvector   │    │  S3 / R2    │
                │  (or Qdrant + OS)      │    │  (PDFs)     │
                └────────────────────────┘    └─────────────┘
```

## Phase 1 — Working MVP (detailed)

### Goal

A deployable single-node TypeScript application that does end-to-end plagiarism detection: library admin can upload reference PDFs; users can submit a suspect; the system asynchronously indexes, retrieves, and judges; the UI shows progressive results. Single Docker Compose, no auth, hardcoded default org, but the data model and module boundaries are production-ready.

Async from day 1 (library indexing takes minutes; HTTP can't carry it). Multi-tenant schema from day 1 (retrofitting `orgId` later is painful) but single-tenant API surface.

### Monorepo layout (pnpm workspaces + Turborepo)

```
apps/
  web/                 # React SPA (Vite + React + React Router)
  api/                 # Fastify + tRPC server
  worker-indexer/      # BullMQ worker — library document indexing
  worker-analyzer/     # BullMQ worker — suspect analysis
packages/
  core/                # Pure pipeline modules (testable in isolation)
  db/                  # Prisma schema, migrations, generated client
  schemas/             # Shared Zod schemas (verdicts, jobs, API contracts)
  llm-clients/         # Voyage + Anthropic wrappers with rate-limit-aware retries
  config/              # Shared tsconfig, eslint, prettier
docker-compose.yml
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
```

### `packages/core/` — pipeline modules (ports of notebook cells)

- **`pdf.ts`** — `extractText(pdfBuffer): Promise<string>` using `unpdf`. Strips trailing `References` / `Bibliography` block (port of `load_pdf` from cell-6). Validate extraction quality on the prototype's library PDFs as a Phase 1 acceptance gate; if quality drops noticeably vs. pymupdf, fall back to a Python sidecar (deferred to Phase 2 only if needed).
- **`chunking.ts`** — port of `chunk_paragraphs` from cell-1. Paragraph splitting with sentence-level fallback for long paragraphs.
- **`embeddings.ts`** — wraps Voyage `voyage-3-large`. Accepts `input_type: "document" | "query"`. Batches inputs, calls Voyage REST API via `fetch`. Returns `number[][]`. Rate-limit pacing is handled by BullMQ at the queue level; within a job, this just batches and retries.
- **`vector-index.ts`** — pgvector queries via Prisma raw SQL (`<=>` cosine distance). `searchVector(orgId, libraryId, queryEmbedding, k)` returns top-k chunk IDs + scores.
- **`bm25.ts`** — `MiniSearch` wrapper, rebuilt from DB rows on worker startup, cached in memory per worker process. Fine up to ~50k chunks (Phase 3 graduates to OpenSearch).
- **`retrieval.ts`** — `hybridSearch(queryText, k)` runs vector + BM25 in parallel and fuses with Reciprocal Rank Fusion (k=60, port of `Retriever.search` from cell-5).
- **`judge.ts`** — Anthropic SDK with **tool-use for structured output**. Tool input schema = Zod verdict schema from `packages/schemas/` converted via `zod-to-json-schema`. Response `tool_use` block is validated against the same Zod schema.
- **`report.ts`** — pure function `buildReport(candidates, verdicts): VerdictReport`. The HTML rendering moves into the frontend; this returns structured data only.

### `packages/db/schema.prisma`

Multi-tenant from day 1; Phase 1 hardcodes a default `Org` row.

```
Org           id, name, createdAt
Library       id, orgId, name, createdAt
Document      id, libraryId, orgId, title, filename, s3Key, status, contentHash, createdAt
Chunk         id, documentId, orgId, chunkIdx, content, contentHash
Embedding     id, chunkId, orgId, vector(1024), model
Suspect       id, orgId, filename, s3Key, status, createdAt
AnalysisJob   id, suspectId, orgId, status, error, startedAt, completedAt
Verdict       id, analysisJobId, candidateDocId, orgId, verdict, plagiarismType,
              confidence, explanation, searchScore, createdAt
EvidencePair  id, verdictId, pairIndex, suspectPassage, libraryPassage,
              searchScore, supportsVerdict, note
```

`Chunk.contentHash` and `Document.contentHash` enable idempotent re-indexing (skip if already embedded). All vector columns use pgvector's `vector(1024)` type.

`status` is a state machine: `pending | parsing | embedding | indexed | failed` (documents) and `pending | parsing | searching | judging | done | failed` (analyses).

### `packages/schemas/` — Zod as single source of truth

```ts
// verdict.ts
export const VerdictSchema = z.object({
  verdict: z.enum(["plagiarism", "suspicious", "legitimate_reuse", "no_match"]),
  plagiarism_type: z.enum(["verbatim", "light_paraphrase", "heavy_paraphrase",
                           "structural_mimicry", "none"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  evidence_annotations: z.array(z.object({
    pair_index: z.number().int(),
    supports_verdict: z.boolean(),
    note: z.string(),
  })),
});

// job-payloads.ts — BullMQ job data
export const IndexDocumentJobSchema = z.object({ documentId: z.string(), orgId: z.string() });
export const AnalyzeSuspectJobSchema = z.object({ analysisJobId: z.string(), orgId: z.string() });
```

The same `VerdictSchema` is used to:

1. Generate the JSON Schema sent to Anthropic as a tool definition.
2. Validate Claude's `tool_use` response in the analyzer worker.
3. Type the Prisma model adapter that writes `Verdict` rows.
4. Type the tRPC response that feeds the frontend.

### `apps/api/` — Fastify server + tRPC routers

```
library.documents.list           input: { libraryId } → Document[]
library.documents.create         input: { libraryId, filename } → { documentId, uploadUrl }
library.documents.confirmUpload  input: { documentId } → enqueues index-document job
library.documents.delete         input: { documentId } → cascades chunks/embeddings/BM25

analyses.create                  input: { filename } → { analysisJobId, uploadUrl }
analyses.confirmUpload           input: { analysisJobId } → enqueues analyze-suspect job
analyses.get                     input: { analysisJobId } → AnalysisJob + Verdicts so far
analyses.subscribe               input: { analysisJobId } → SSE/observable, streams verdicts as they're written
```

Upload flow: API returns a presigned S3 URL; client uploads directly to S3; client calls `confirmUpload` which enqueues the job. Avoids streaming PDFs through the API tier.

Hosting: a standalone Fastify server using `@trpc/server/adapters/fastify`. With a React SPA frontend this server is **required** — there is no Next.js server to fold tRPC into. In Phase 1 it also serves the built SPA via `@fastify/static` (single origin, no CORS); once the SPA moves to a CDN, enable `@fastify/cors` for the SPA origin.

### Workers (BullMQ)

- **`worker-indexer`** consumes the `index-document` queue. Per-queue rate limit configured to Voyage's tier (`limiter: { max: 3, duration: 60_000 }` for free tier). Steps: download PDF from S3 → extract text → chunk → batch-embed → upsert `Chunk` + `Embedding` rows (skip rows whose `contentHash` already exists) → update `Document.status`.
- **`worker-analyzer`** consumes the `analyze-suspect` queue. Steps: download suspect PDF → extract + chunk → for each chunk run `hybridSearch` → aggregate to top-5 candidate docs → for each candidate, call Claude judge → write `Verdict` + `EvidencePair` rows as each completes (so SSE can stream) → mark `AnalysisJob.status = done`.

Both workers are written so a redelivered job is a no-op when its outputs already exist (idempotency via `contentHash` and unique constraints).

### `apps/web/` — React SPA (Vite + React + React Router)

Static single-page app — **no server runtime**. Vite builds it to static assets, served from a CDN (or by the API server via `@fastify/static` in Phase 1). Client-side routes:

- `/libraries/:id` — admin view. Document list with status pills, drag-drop upload, deletion.
- `/analyze` — suspect upload form. On submit: presigned upload → `confirmUpload` → navigate to result route.
- `/analyses/:id` — result page. Subscribes to `analyses.subscribe` over tRPC (SSE via `httpSubscriptionLink`); renders candidate cards as verdicts arrive. Layout mirrors the prototype's HTML report (candidate cards ordered by severity, evidence-pair tables, verdict badges).
- Uses the `@trpc/react-query` client and imports the `AppRouter` *type* from `apps/api` — full end-to-end type safety, no codegen step.

### Local dev (`docker-compose.yml`)

```
services:
  postgres:    image with pgvector extension
  redis:       for BullMQ
  api:         Fastify on :3001
  worker-indexer
  worker-analyzer
  web:         Vite dev server on :5173 (proxies tRPC calls to api)
  minio:       S3-compatible local object storage on :9000
```

`pnpm dev` from the root runs everything via Turborepo. Single `.env` with `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, S3/Postgres/Redis URLs.

### Phase 1 verification

1. `docker compose up` — all six services start cleanly.
2. Through the web UI, upload the 7 library PDFs from the prototype's `docs/library/`. Each transitions `pending → parsing → embedding → indexed`.
3. Upload `suspect_paraphrased.pdf` through the analyze page. The result page shows status progression and verdicts streaming in.
4. Compare the rendered verdicts against the prototype's `suspect_paraphrased_report.html` — verdict labels, confidence values, and evidence pairs should be functionally identical (within Claude's nondeterminism).
5. Kill `worker-indexer` mid-job, restart it — the job resumes without duplicating embeddings.
6. `pnpm typecheck` across the monorepo passes; `pnpm test` runs unit tests for `packages/core`.

## Phases 2–5 (sketched — building blocks per phase)

### Phase 2 — Hosted deploy + observability

- Deploy API and each worker as separate services to Cloud Run / Fly.io / Railway.
- Build the React SPA and deploy it to a static host / CDN (Cloudflare Pages, Netlify, or S3 + CloudFront); point it at the API origin and enable CORS on the API.
- Managed Postgres (Neon, Supabase, RDS) with pgvector enabled.
- Object storage moves from MinIO → S3 / R2.
- **Pino** structured logging across all services.
- **Sentry** for error tracking.
- **Bull Board** dashboard for queue depth, failed jobs, retry visibility.
- Daily Postgres backups + restore drill.

### Phase 3 — Specialized stores (when needed)

- Trigger: library exceeds ~50k chunks, or BM25-in-memory startup time becomes painful, or vector search latency exceeds budget.
- **OpenSearch / Elasticsearch** replaces MiniSearch for BM25. Workers become fully stateless on startup.
- **Qdrant** (or keep pgvector) for vectors — only if pgvector latency becomes the bottleneck at the actual scale.
- Workers can autoscale to zero.

### Phase 4 — Centralized outbound rate-limit gateway

- Small Node service (or sidecar) fronting *all* outbound Voyage and Anthropic calls. Redis-backed token bucket per upstream API.
- All workers route LLM/embedding traffic through it via a typed client in `packages/llm-clients/`.
- Enables: cross-queue rate limit enforcement (BullMQ's limiter is per-queue, not per-API), circuit breakers, per-org cost caps, request prioritization, and centralized retry policy in one place.
- This is the keystone for horizontal scale — without it, adding worker replicas violates upstream rate limits.

### Phase 5 — Production hardening

- **Auth**: token-based, since the frontend is a static SPA — Clerk, Auth0, or Lucia/custom JWT (httpOnly cookie). Auth.js/NextAuth assumes a Next.js server, so it does not fit here. Token flows through tRPC context; relevant identifiers propagate to workers via the job payload.
- **Multi-tenancy enforcement** at the API layer (schema already supports it). Every tRPC query scopes by `ctx.orgId`.
- **PDF parsing sandbox**: isolate the parser in a worker process with restricted network/filesystem permissions, or graduate to a Python sidecar with no egress.
- **Prompt-injection defenses**: delimiter-wrap suspect text in the judge prompt; pre-scan suspect text for known injection patterns; optionally pre-summarize suspect text through a separate Claude call so the judge never sees raw attacker-controlled tokens.
- **OpenTelemetry** end-to-end traces (API → queue → worker → upstream API).
- **GDPR deletion**: cascading deletes across S3, Postgres, vector index, BM25 index.
- **Cost monitoring**: per-org token counts logged per job; daily spend dashboard; alerting on threshold breaches.

## Key design decisions

1. **Async from day 1.** Synchronous HTTP cannot carry library indexing. BullMQ + Redis is the foundation, not a Phase 2 addition.
2. **Multi-tenant schema, single-tenant API in Phase 1.** Every row gets `orgId`; Phase 1 hardcodes a default org. Retrofitting tenancy later requires rewriting every query.
3. **Zod is the single schema language.** HTTP boundaries, LLM tool-use, BullMQ job payloads, and DB row adapters all reuse the same Zod schemas. The judge verdict schema is the most reused type in the system.
4. **Anthropic tool-use, not JSON-in-prompt.** Tool input schema is the Zod verdict schema converted to JSON Schema; responses are validated against the same Zod schema.
5. **pgvector first, Qdrant when measured.** pgvector handles ~1M vectors in a single Postgres comfortably. Do not add Qdrant until pgvector latency is a measured bottleneck.
6. **In-process BM25 in Phase 1, OpenSearch in Phase 3.** MiniSearch rebuilds from DB on worker start. Fine up to ~50k chunks.
7. **Streaming verdicts via SSE.** The judge runs 5 candidates sequentially; write each `Verdict` row as it completes and stream to the UI. Big UX win for low implementation cost.
8. **PDF parsing in TS via `unpdf`.** Validate extraction quality against the prototype's library as a Phase 1 acceptance gate. Fall back to a Python sidecar in Phase 2 only if quality is meaningfully worse.
9. **BullMQ queue-level rate limit in Phase 1; centralized gateway in Phase 4.** The queue limiter is sufficient when one worker pool talks to one upstream. The gateway becomes necessary when multiple worker types share an upstream API budget.
10. **Idempotency via content hashes everywhere.** Re-running a job (worker crash, queue redelivery) must not duplicate work or rows.
11. **React SPA + standalone API, not Next.js.** The frontend is a static Vite build with no server runtime, so tRPC must be hosted by a standalone Fastify server (`apps/api`) — there is no option to fold the API into the frontend. tRPC's end-to-end type safety is preserved through the `@trpc/react-query` client importing the `AppRouter` type.

## Files to be created (Phase 1)

- Workspace root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.env.example`, `docker-compose.yml`.
- `apps/api/`: Fastify app (tRPC adapter, `@fastify/static` for the SPA, `@fastify/cors`), tRPC routers, BullMQ producers, S3 presigned URL helper.
- `apps/worker-indexer/`, `apps/worker-analyzer/`: BullMQ worker entry points + job handlers.
- `apps/web/`: Vite + React SPA (React Router routes `/libraries/:id`, `/analyze`, `/analyses/:id`), `@trpc/react-query` client, upload UI.
- `packages/core/`: `pdf.ts`, `chunking.ts`, `embeddings.ts`, `vector-index.ts`, `bm25.ts`, `retrieval.ts`, `judge.ts`, `report.ts` + unit tests.
- `packages/db/`: `schema.prisma`, migration files.
- `packages/schemas/`: Zod schemas (`verdict.ts`, `job-payloads.ts`, `api.ts`).
- `packages/llm-clients/`: `voyage.ts`, `anthropic.ts` with shared retry/backoff helpers.

## End-to-end verification (Phase 1)

1. `docker compose up` brings all services online; health endpoints return 200.
2. Upload 7 library PDFs through the web UI; confirm each transitions to `indexed` and embeddings/BM25 entries exist in Postgres.
3. Upload `suspect_paraphrased.pdf` through `/analyze`; confirm the analysis page receives streamed verdicts via SSE.
4. Verdict labels, confidence values, and evidence pairs match the prototype's HTML report output within Claude's expected nondeterminism.
5. Kill `worker-indexer` mid-job; restart; confirm idempotent resume (no duplicate `Embedding` rows for the same `chunkId + contentHash`).
6. `pnpm typecheck`, `pnpm test`, `pnpm lint` all pass at the workspace root.
7. PDF-extraction parity test: a fixture comparing `unpdf` output against the prototype's pymupdf output on the library PDFs; if character-level diff exceeds an agreed threshold on any doc, flag for Phase 2 Python-sidecar fallback.
