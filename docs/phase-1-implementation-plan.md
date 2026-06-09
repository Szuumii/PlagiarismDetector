# Phase 1 Implementation Plan — Plagiarism Detector (TypeScript MVP)

## Context

`production-plan.md` describes migrating a proven four-stage pipeline (chunk → embed → hybrid retrieve → LLM-as-judge) from a Python notebook prototype into a production TypeScript stack. **Phase 1** is the deployable single-node MVP: a library admin uploads reference PDFs into a single shared library, a user submits a suspect PDF, the system asynchronously indexes/retrieves/judges against that shared library, and the UI streams progressive verdicts. Single Docker Compose, no auth, hardcoded default org — but **asymmetric multi-tenancy from day 1** (library side global, analysis side per-org — see `production-plan.md` key decision #2) and **async from day 1** (indexing takes minutes; HTTP can't carry it).

This document is the _implementation_ plan: an ordered, milestone-based build sequence the user will execute with Claude's help. It deliberately keeps prototype references generic — the user will wire in the actual notebook logic, chunking params, RRF constant, judge prompt, and PDF fixtures as they go.

**Repo state:** greenfield (only `README.md`, `architecture.excalidraw`, `production-plan.md`). The notebook and PDFs are _not_ in the repo yet; the user adds them during implementation.

## Strategy

**Vertical slice first.** Build the type-sharing spine, then the thinnest end-to-end happy path with every external brain (PDF parse, Voyage, retrieval, Claude) faked, then swap in real implementations layer by layer. Don't build the real pipeline until the wire that carries its output — upload → queue → worker → DB → SSE → UI — is proven on fake data.

Milestones are sized to map onto individual Claude-assisted coding sessions. Each produces something runnable/verifiable.

---

## M0 — Monorepo skeleton + the type spine

The riskiest "boring" milestone. The whole architecture rests on the `AppRouter` type flowing api → web cleanly and on the Prisma client being generated before dependents build.

> **Progress — updated 2026-05-27: M0 COMPLETE (type spine wired).** All three exit criteria pass: (1) `npx turbo build` succeeds cold (8/8); (2) web fetches `health.ping` over tRPC with end-to-end inference — verified by curl (`{"ok":true,"ts":…}`) and a rename test (renaming the api procedure breaks web's typecheck with TS2339); (3) the web production bundle contains zero server code (no fastify / @trpc/server / PrismaClient / initTRPC / bullmq / ioredis). `packages/schemas` exports real Zod schemas (`VerdictSchema`, `IndexDocumentJobSchema`, `AnalyzeSuspectJobSchema`); `apps/api` runs Fastify 5 + tRPC (`fastifyTRPCPlugin`); `apps/web` uses `@trpc/react-query` + TanStack Query. `apps/web/tsconfig.json` sets `declaration: false` (no-emit app) to dodge TS2742 on the inferred tRPC client type.
>
> **Deferred to M1 (not part of M0's exit criteria):** the full Prisma model set — only the `Org` tenancy root + the `db` singleton client exist so far — plus wiring `DATABASE_URL` and the default `orgId` into the tRPC context. Minor: `db:generate` is inlined in `@repo/db`'s build script rather than wired as a `turbo` prerequisite.

**Tasks**

- [x] Root `package.json` with npm `workspaces: ["apps/*", "packages/*"]` + `turbo.json` with tasks: `build`, `dev`, `lint`, `typecheck`, `db:generate`. Wire `db:generate` and package `^build` as prerequisites so the Prisma client and built packages exist before dependents compile. (Turborepo runs on top of npm; no `pnpm-workspace.yaml`.)
- [x] `packages/config`: shared `tsconfig.base.json`, eslint, prettier. **Decide ESM now**: `"type": "module"` everywhere, `moduleResolution: "NodeNext"` (packages/apps) or `"Bundler"` (web), `isolatedModules: true`. Retrofitting ESM later is painful (unpdf is ESM-only; BullMQ/Fastify/tRPC v11 prefer ESM).
- [x] `packages/schemas`: real exports even if minimal — `VerdictSchema`, `IndexDocumentJobSchema`, `AnalyzeSuspectJobSchema`. **All shared runtime contracts live here**, never in `apps/api`.
- [ ] `packages/db`: Prisma schema with all models (see M1 for the pgvector detail); `postinstall` runs `prisma generate`.
- [x] `apps/api`: Fastify + trivial tRPC router (`health.ping`). Export **only the type**: `export type { AppRouter }` from a dedicated `src/router.ts`.
- [x] `apps/web`: Vite + React + tRPC client that calls `health.ping` and renders it. Depend on api via `"api": "*"` (npm workspaces resolve by name; no `workspace:` protocol) but consume types from source via `import type`.

**Exit criteria**

- `npm install && npx turbo build` succeeds cold.
- web renders a value fetched over tRPC with full inference — renaming a procedure in api breaks web's typecheck.
- web's bundle contains zero server code (no Fastify/Prisma/BullMQ pulled in). `isolatedModules` will catch an accidental value-import of a type.

**Key files:** `apps/api/src/router.ts`, `packages/schemas/src/index.ts`, `turbo.json`, `tsconfig.base.json`.

---

## M1 — Infra up: docker-compose + Prisma migrate + pgvector

**Tasks**

- [x] `docker-compose.yml` with `postgres` (pgvector image) and `redis`. Object storage uses **AWS S3** directly (bucket provisioned out-of-band in the AWS console; credentials in `.env`). **Hold off containerizing api/workers/web until M5** — run them on the host against composed infra for fast iteration.
- [x] Prisma: `previewFeatures = ["postgresqlExtensions"]`, `extensions = [vector]` on the datasource. Verify the first migration emits `CREATE EXTENSION IF NOT EXISTS vector`.
- [x] Model the vector column as `Unsupported("vector(1024)")` on `Embedding` (Prisma has no native vector type — it is _not_ readable/writable through the typed client; all vector I/O is raw SQL).
- [x] `packages/llm-clients`: `voyage.ts` + `anthropic.ts` as **typed stubs** (real signatures, deterministic fake output).
- [x] `packages/core/vector-index.ts`: `searchVector(queryEmbedding, k)` stub returning `[]` (library side is global — single shared corpus, no `orgId` or `libraryId` filter).
- S3 bucket is provisioned **manually in the AWS console** (Block Public Access ON, CORS allowing the web origin + `PUT`/`GET`/`HEAD` and exposing `ETag`, dedicated IAM user with least-privilege `s3:PutObject`/`s3:GetObject`/`s3:ListBucket` on this bucket only). No bootstrap code in `apps/api`.

**Exit criteria**

- `docker compose up` brings up pg/redis; `prisma migrate dev` applies cleanly; `\d "Embedding"` shows `vector(1024)`.
- A throwaway `$queryRaw` of `'[...]'::vector(1024) <=> '[...]'::vector(1024)` returns a cosine distance.

**Key files:** `packages/db/prisma/schema.prisma`, `docker-compose.yml`.

---

## M2 — Walking skeleton: upload → index → analyze → fake verdict in the UI

**THE vertical slice.** Every external brain faked; every pipe real. Build the SSE plumbing for real here (highest-risk pipe) even with fake data.

> **Progress — updated 2026-06-01: M2 Task 1 (upload flow) COMPLETE.** End-to-end verified via curl: `library.documents.create` → presigned S3 PUT (200 + ETag) → `confirmUpload` → BullMQ job in `bull:index-document` with payload `{documentId, objectKey}`; same shape for `analyses.create`/`confirmUpload` → `bull:analyze-suspect` with `{orgId, analysisJobId, objectKey}`. Idempotency proven on both sides: library via BullMQ `jobId: documentId` dedup; analyses via a `findFirst` guard on in-flight AnalysisJobs (AnalysisJob is created per-confirm by design, so the jobId trick alone wouldn't dedup — the guard short-circuits before the transaction). Error paths: 422 `UNPROCESSABLE_CONTENT` for missing rows, 400 `BAD_REQUEST` from Zod `.uuid()` boundary. Schema changes applied: dropped `Library` model entirely (`Document`/`Chunk`/`Embedding` are now global, no `orgId`); seeded a default `Org` for the per-org analysis side. New shared utility `@repo/config/env` exposes `requireEnv()`. Fixed two infra footguns surfaced during M2: `turbo.json` needed `globalEnv` allowlist (Turborepo 2.x strict env mode strips unlisted vars from task processes), and all package `dev` scripts now use `tsdown --watch --no-clean` to avoid the dist-clean ↔ tsx-startup race the first time api imports a workspace package at runtime.
>
> **Progress — updated 2026-06-02: M2 Task 2 (worker-indexer) COMPLETE.** Worker consumes `index-document` from Redis, walks `Document.status` `pending → parsing → embedding → indexed`, writes Chunk + Embedding rows idempotently. Per-module split: `s3.ts` (own `S3Client`, `getObjectBody` via `transformToByteArray`), `queues.ts` (own ioredis with `maxRetriesPerRequest: null` — workers can't share with api due to BullMQ blocking commands; `QUEUE_NAMES` duplicated rather than promoted), `processor.ts` (pure happy-path linear pipeline), `index.ts` (lifecycle: `Worker` bootstrap + `completed`/`failed` event listeners + SIGTERM/SIGINT shutdown). Chosen pattern: **status-flip-on-failure lives in the `worker.on("failed")` listener**, not in the processor's try/catch — so processor.ts is unit-testable in isolation and failure reactions scale without touching business logic. Listener `safeParse`s `job.data` defensively (the throw might be the schema parse itself). Pipeline modules in `@repo/core`: `pdf.ts`/`chunking.ts`/`embeddings.ts` are M2 stubs with the M3 signatures (`extractText: Uint8Array → Promise<string>`, `chunk: string → Chunk[]`, `embed: string[] → Promise<number[][]>` returning a zero 1024-vector per input). Idempotency: Chunk via `db.chunk.upsert` on the compound `documentId_chunkIdx` constraint; Embedding via raw `INSERT ... ON CONFLICT ("chunkId") DO UPDATE` because the `vector` column is `Unsupported`. Vector literal format `'[0,0,...]'::vector` (square brackets, not Postgres curly braces — confused once, won't again). Verified end-to-end: lewis2020 PDF → 3 chunks + 3 embeddings with `vector_dims = 1024`, model `fake-m2-zero`, document.status = `indexed`.
>
> **Progress — updated 2026-06-02: M2 Task 3 (worker-analyzer) COMPLETE.** Same `s3.ts`/`queues.ts`/`processor.ts`/`index.ts` split as the indexer, plus a new `pubsub.ts` (dedicated `IORedis` for fire-and-forget `PUBLISH` — separate from the BullMQ blocking connection). Status machine: `pending → parsing → searching → judging → done` (or `failed`), with `startedAt`/`completedAt` timestamps populated on transitions (AnalysisJob has these columns; Document doesn't — Document didn't need them in Task 2). Failure handler in `index.ts` populates the `error: String?` column with `err.message` — another AnalysisJob-only field. Per-candidate loop: idempotency probe via `findUnique` on the `analysisJobId_candidateDocId` compound unique → skip; candidate resolution with `findUnique + null skip` (a deleted Document shouldn't sink the job); judge call; `Verdict + EvidencePair` write as a single Prisma nested-create transaction with `include: { evidence: true }`; pub/sub publish AFTER the DB write (load-bearing for Task 4's "replay-from-DB-then-switch-to-live" SSE design — invariant: every published verdict already exists in the DB). New stubs in `@repo/core`: `retrieval.ts` (`hybridSearch(suspectText, k)` returning `findMany({ where: { status: "indexed" } })` with synthetic descending scores) and `judge.ts` (returns a fresh `VerdictSchema.parse({...})` `no_match` constant per call). Shared `verdictChannel(analysisJobId)` helper in `@repo/schemas` — single source of truth between worker publisher and api subscriber (Task 4). Three-connection Redis pattern per process now codified: BullMQ blocking (`maxRetriesPerRequest: null`), pub/sub publisher (default opts), and (in Task 4) SSE subscriber (locks the connection). Verified end-to-end: analysisJob walks through all states, Verdict + EvidencePair rows written, `PSUBSCRIBE 'verdicts:*'` shows the live JSON.
>
> **Progress — updated 2026-06-02: M2 Task 4 (SSE) REPLACED by polling endpoint** — SSE deferred for now to simplify the walking skeleton. New tRPC query `analyses.get({ analysisJobId })` returns `{ id, status, error, startedAt, completedAt, verdicts: [{ ...verdict, evidence: [...] }] }`. Dates serialized as ISO strings on the wire (`z.string().datetime().nullable()` — no superjson transformer configured). Per-org scoped via `findUnique({ where: { id, orgId } })` using Prisma's extended-where on a unique field. 422 `UNPROCESSABLE_CONTENT` on missing. Nested `include` walks AnalysisJob → verdicts → evidence (ordered by `pairIndex` asc). Real SSE (the BullMQ `QueueEvents` + Redis pub/sub subscriber) parked as a Phase-2 polish item — every primitive needed is already on the publish side (`pubsub.ts`, `verdictChannel` helper), only api-side subscriber + observable wiring missing.
>
> **Progress — updated 2026-06-02: M2 Task 5 (minimal UI) COMPLETE — M2 walking skeleton end-to-end usable from a browser.** Single-page React app in `apps/web/src/` with three components: `LibraryUploadForm` (title + file → `library.documents.create` → presigned PUT → `confirmUpload`), `AnalysisUploadForm` (file → `analyses.create` → PUT → `confirmUpload`, raises `onAnalysisStarted(analysisJobId)`), `AnalysisResults` (polls `analyses.get` via `useQuery` with `refetchInterval` callback — returns `false` on terminal `done`/`failed` status, `1500`ms otherwise). `App.tsx` holds a single `useState<string | null>` for the current analysis; results panel renders only when set. Vanilla `App.css` (~70 lines), no UI/form libs, no router (`react-router-dom` is in deps but unused — Phase 2). `Content-Type: "application/pdf"` pinned in both upload forms — same string the api signs presigns for, mismatch → S3 403. Verified: real PDFs round-trip through library + analyze flows, UI shows status transitions during polling, verdict renders on completion.
>
> **Sidequest landed during Task 5: api types now ship from a pre-compiled .d.ts.** Original setup had `apps/api/package.json` `exports.types: "./src/router.ts"` — web's tsc traversed api's source and hit cross-package `@/` alias conflicts (both api and web use `@/*` for their own src; no clean way to disambiguate). Fix: `apps/api/tsdown.config.ts` now emits `dts: true`, `apps/api/src/index.ts` re-exports `AppRouter` so it lands in the dts, `exports.types` points at `./dist/index.d.ts`. Web reads pre-resolved types; `@/` aliases stay everywhere in api source. Build dependency via turbo's `^build` ensures api is built before web typechecks. Cost: api's dist/index.d.ts is ~650KB (inlines tRPC type machinery); negligible since web reads it once.
>
> **Deferred:** real `contentHash` dedupe on Document — column exists (`@unique`, nullable), populated by the worker in M3. AnalysisJob → done/failed cleanup paths land in M5. Vector dim assertion (`vector.length === EMBED_DIM`) lands in M3 when real Voyage calls can return a misconfigured dim. Document content assembly from Chunk rows (for the judge's `candidate.content` argument) lands in M3 — M2 fake judge ignores the parameter so we pass `candidate.title` as a placeholder. Real SSE (`analyses.subscribe`) — pub/sub publisher already in place, only api-side subscriber + tRPC observable needed; revisit when polling latency becomes annoying.

**Tasks**

- [x] Upload flow: `library.documents.create` → presigned S3 PUT URL → browser uploads directly → `confirmUpload` → enqueue `IndexDocumentJob`. Same shape for `analyses.create`/`confirmUpload` → `AnalyzeSuspectJob`.
- [x] `worker-indexer`: real S3 download + real `Chunk`/`Embedding` upserts + real `Document.status` transitions; **fake** extract (constant string), **fake** chunk (split on `\n\n`), **fake** embed (constant 1024-vector).
- [x] `worker-analyzer`: real `Verdict`/`EvidencePair` writes + real status transitions; **fake** hybridSearch (return the one indexed doc) and **fake** judge (hardcoded valid `VerdictSchema` object).
- [x] ~~`analyses.subscribe` SSE~~ → replaced with polling `analyses.get` query; SSE deferred to Phase 2 polish.
- [x] Minimal UI: upload a library doc, upload a suspect, watch a verdict ~~stream~~ poll in without a refresh.

**Exit criteria**

- From the browser: upload one PDF, upload one suspect, see a (fake) verdict appear via SSE — no manual refresh.
- Document: `pending→…→indexed`; AnalysisJob: `pending→…→done` in the DB.
- Re-running the index job produces **no duplicate** Chunk/Embedding rows (idempotency proven on fake data — easier now than later).

**Key files:** `apps/api/src/routers/*`, `apps/worker-indexer/src/index.ts`, `apps/worker-analyzer/src/index.ts`, `apps/api/src/subscriptions`.

---

## M3 — Real ingestion: PDF extract + chunking + Mistral embeddings

> **Progress — updated 2026-06-03: M3 COMPLETE — real ingestion working end-to-end with Mistral.** Pivoted from Voyage to Mistral mid-milestone after Voyage's free tier (3 RPM + 10K TPM, where the TPM cap is the binding constraint at our chunk sizes) made even single-PDF indexing unworkable. Mistral's free tier (6 RPS, 500K tokens/month) handles real PDFs without pacing. The provider swap is encapsulated entirely in `packages/llm-clients/src/mistral.ts` + a one-line import change in `packages/core/src/embeddings.ts`; no API/worker/schema code touched.
>
> **What landed:**
>
> - **`packages/core/pdf.ts`**: real `unpdf` extraction via `extractText(buffer, { mergePages: true })`, whitespace normalization (`\r\n? → \n`, collapse `\n{3,}` → `\n\n`), and tail-only References/Bibliography stripping (regex `/^\s*(references|bibliography|works cited)\s*$/gim`, strips only if the _last_ match falls past the 70% position mark — avoids false positives on body-text mentions).
> - **`packages/core/chunking.ts`**: paragraph split on `\n{2,}`, drop fragments < 40 chars, sentence-fallback (`(?<=[.!?])\s+`) for paragraphs > 2000 chars with greedy merge targeting 1500 chars/chunk. Oversize single sentences pass through solo (no sub-sentence splits).
> - **`packages/llm-clients/src/mistral.ts`**: `POST /v1/embeddings` against `mistral-embed` (1024 dim, matches schema), 128-input batching, dim assertion at the response boundary, exhaustive diagnostic logging (`[mistral:fetch]` per attempt + `[voyage:limiter]`-style state), 429/5xx retry with `Retry-After` honor + exponential backoff. No rate limiter — Mistral free tier is generous enough that pacing is unnecessary; the retry loop handles any 429 defensively.
> - **`apps/worker-indexer/src/s3.ts`** (+ analyzer duplicate): dropped `Buffer.from(bytes)` wrap, now returns `Uint8Array` directly. Closes Node/Prisma deprecation warnings about Buffer-vs-Uint8Array.
> - **`apps/worker-indexer/src/processor.ts`**: real ingestion path with **Chunk-ID based skip-already-embedded** for retry idempotency. `db.embedding.findMany({ where: { chunk: { documentId } } })` finds which chunks already have vectors; subsequent runs filter `needEmbedding = persistedChunks.filter(c => !embeddedChunkIds.has(c.id))` and skip the Mistral call entirely when zero are needed. The smoking-gun log line `[indexer] all chunks already embedded, skipping Mistral` confirms the path fires on retry.
>
> **Sidequest: Voyage rate-limiter exploration (now removed).** Spent meaningful time on a token-bucket rate limiter for Voyage's 3 RPM cap — burst calibration, promise-chain mutex for concurrent acquires, sliding-window vs token-bucket tradeoffs, 30s call interval to leave headroom against strict 60s window enforcement. Worked correctly but couldn't address the TPM ceiling. All scrapped when we moved to Mistral. The lesson worth keeping: **free-tier rate limits are usually engineered to be unusable for anything real** — they're gates, not tiers.
>
> **Schema work that landed and was then removed.** Followed the "real `contentHash` on Document + Chunk" plan through three migrations: (1) Chunk.contentHash `@unique` → `@@unique([documentId, contentHash])` to allow cross-document content overlap; (2) drop `@unique` from Document.contentHash to allow re-uploading the same PDF; (3) **drop both `contentHash` columns entirely** when we recognized they were forward-compatibility infrastructure for Phase 2 cross-doc embedding cache + upload-time dedup — neither of which is in M3 scope. The active retry-idempotency win (skip-already-embedded) uses `Chunk.id` not `contentHash`, so removing the columns didn't regress anything observable. Phase 2 will re-add when actually needed.
>
> **Deferred to M4 / Phase 2:**
>
> - Content-hash columns + cross-doc embedding cache + upload-time document dedup.
> - HNSW vector index (lands with real retrieval).
> - tiktoken-aware chunk sizing (char-count proxy is adequate at our scales).
> - OCR fallback for scanned-image PDFs.
> - `unpdf` Docker compatibility check.

**Tasks**

- [x] `packages/core/pdf.ts`: `extractText` via `unpdf`, strip trailing References/Bibliography block.
- [x] `packages/core/chunking.ts`: paragraph split with sentence-level fallback for long paragraphs.
- [x] `packages/core/embeddings.ts` + ~~`voyage.ts`~~ `mistral.ts`: real client, batched `fetch`, returns `number[][]`. Dim asserted at response boundary. (**Provider pivoted from Voyage to Mistral** — see progress note.)
- [x] ~~Real `contentHash` on Document + Chunk; skip the Voyage call entirely when a Chunk/Embedding with that hash already exists~~ → **Slimmed to skip-already-embedded via `Chunk.id` lookup** (Phase 2 substrate scrapped).
- [x] ~~Rate limiting: token-bucket inside `voyage.ts`~~ → Removed with the Mistral pivot. Free-tier Mistral doesn't require pacing; retry loop handles 429s defensively.

**Exit criteria**

- A real academic PDF indexes end-to-end; Embedding rows hold genuine 1024-dim vectors. ✓
- Re-indexing the same documentId skips all rows and makes no Mistral calls. ✓ (via Chunk-ID skip, not content-hash)
- ~~The in-client limiter visibly paces requests without failing the job.~~ N/A — limiter removed.

**Key files:** `packages/core/{pdf,chunking,embeddings}.ts`, `packages/llm-clients/src/mistral.ts`, `apps/worker-indexer/src/processor.ts`, `apps/worker-indexer/src/s3.ts`.

---

## M4 — Real retrieval + real judge

> **Progress — updated 2026-06-09: M4 COMPLETE — real retrieval + real judge end-to-end.** A real suspect now walks `pending → parsing → searching → judging → done` with genuine `Verdict` rows (label + confidence + reasoning + evidence pairs) emitted by Claude. Two notable pivots away from the original M4.3 lock — both simplifications, both worth flagging:
>
> **Pivot 1 — AI SDK v6 instead of raw Anthropic tool-use.** `packages/llm-clients/src/anthropic.ts` is a one-function module: `generateStructured({ systemPrompt, userMessage, schema, schemaName, schemaDescription })` wraps Vercel `ai`'s `generateText` + `Output.object({ schema })`. The SDK does the Zod → tool JSON conversion, the `tool_choice` forcing, the `tool_use` block extraction, the `safeParse`, and the model-repair retry internally — so the hand-rolled `callTool` + `zodToJsonSchema({ $refStrategy: "none" })` + strip-`$schema` + find-block-by-name + retry-once-on-parse-failure machinery from the locked plan never landed. Model: `claude-sonnet-4-6`, `maxOutputTokens: 2000`. The pivot is recorded in [[feedback-ai-sdk-v6]] (pin `ai@^6` + `@ai-sdk/anthropic@^3`).
>
> **Pivot 2 — aggregate-evidence-per-doc instead of fan-out-per-chunk + synthesis.** Locked plan: one `evaluateChunk` sub-agent per suspect chunk (suspicion: high/medium/low/none + reasoning) under a semaphore, then a final `synthesizeVerdicts` call per candidate doc. Landed: a single `judge(input)` per candidate document. The analyzer runs `hybridSearch(suspectChunk, 5)` for every suspect chunk in `Promise.all` (DB-only, no LLM yet), aggregates the resulting `RetrievalHit`s into a `Map<documentId, EvidenceSeed[]>`, picks the top **5 candidate documents** by summed similarity score, keeps the top **5 evidence pairs per candidate** (sorted desc by score), and calls `judge()` once per candidate with the suspect + candidate summaries (= chunk 0 of each) and those evidence pairs. The candidate loop is sequential — top-M capped at 5 means a semaphore would buy nothing; ordered logging beats parallelism here. Per-candidate idempotency via `db.verdict.findUnique` on `analysisJobId_candidateDocId` before the LLM call.
>
> **Schema side-effect of pivot 2.** The `ChunkFindingSchema` + `SynthesisBatchSchema` that landed in `cad9075 feat: add schema for sub-agents` were dropped when the fan-out/synthesis split was abandoned — `packages/schemas/src/index.ts` now exports only `VerdictSchema` + `EvidencePairSchema` on the judge side. AI SDK's `Output.object({ schema: VerdictSchema, name, description })` validates the model response against `VerdictSchema` directly; no intermediate schemas needed.
>
> **Sidequest: storage extracted to `@repo/storage`.** Both worker apps had identical `s3.ts` modules (own `S3Client`, `getObjectBody` via `transformToByteArray`). Promoted to a shared package with a single `storage.getObject(key)` surface (`0d6f213 feat: extract S3 logic into shared @repo/storage package`). Worker processors now just `import { storage } from "@repo/storage"` — eliminates the duplicate I called out as acceptable in M2 Task 2/3.
>
> **What landed in code (final shape):**
>
> - **`packages/core/src/vector-index.ts`** (M4.1): real `searchVector(queryEmbedding, k)` via `$queryRaw`. JOINs `Embedding → Chunk → Document`; filters `Document.status='indexed'`; orders by `e.vector <=> '[...]'::vector`. Returns cosine _similarity_ as `1 - distance` (more intuitive for downstream consumers than raw distance). Dim guard up front (throws on non-`EMBED_DIM` input). No HNSW — flat scan, sub-100ms at Phase 1 scale; lands when latency becomes a real signal.
> - **`packages/core/src/bm25.ts`** (M4.2): `bm25Search(query, k)` backed by MiniSearch v7 (BM25 by default). Module-level cached index; single-flight `rebuildBM25Index()` (concurrent callers share a single in-flight rebuild via a `pendingRebuild` Promise). Empty-corpus guard returns `[]`. Analyzer calls `rebuildBM25Index()` at job start.
> - **`packages/core/src/retrieval.ts`** (M4.2): `hybridSearch(query, k)` embeds the query once, runs `searchVector` + `bm25Search` in parallel each with `k * 3` candidates, fuses via Reciprocal Rank Fusion (`RRF_K = 60`, Cormack et al. 2009). Returns `RetrievalHit[]` at _chunk_ granularity.
> - **`packages/core/src/judge.ts`** (M4.3): single `judge(input: JudgeInput): Promise<Verdict>` export. `JudgeInput` carries `suspectSummary` + a `JudgeCandidate` (documentId, title, summary, `evidencePairs: { suspectText, sourceText, score }[]`). User message is XML-tagged (`<suspect_summary>`, `<candidate>`, `<evidence_pairs>` with per-pair `idx`+`score` attributes) so the model can address pairs unambiguously. System prompt covers label semantics (plagiarism/paraphrase/no_match), confidence calibration bands, evidence-selection guidance (1–5 pairs verbatim with `note`), and anti-patterns (shared terminology ≠ plagiarism).
> - **`packages/llm-clients/src/anthropic.ts`** (M4.3): `generateStructured` over `ai` v6's `generateText` + `Output.object`. `ANTHROPIC_API_KEY` required via `requireEnv` at module load.
> - **`apps/worker-analyzer/src/processor.ts`** (M4.3): the aggregate-then-judge flow described above. Status walks `pending → parsing → searching → judging → done`. Worker shutdown/failure handling unchanged from M2 (lives in `index.ts`'s `worker.on("failed")`).
>
> **Deferred:**
>
> - **`report.ts`** — pure aggregator over Verdict/EvidencePair. No consumer demands it yet; `analyses.get` returns DB rows directly. Add when a summary view / export feature lands.
> - **HNSW index** on `Embedding.vector` — still flat scan. Add when retrieval becomes a hotspot.
> - **BM25 cross-job staleness fix** (Phase 2 followup — see the M4.2 task line below for the Redis-pubsub design sketch).
> - **Fan-out + per-chunk sub-agents** — only worth revisiting if aggregate-per-doc misses cases where one chunk is clear plagiarism but the doc's overall evidence is diluted by unrelated chunks. Not observed yet.
>
**Tasks**

- [x] `packages/core/vector-index.ts`: raw-SQL `searchVector` with `ORDER BY vector <=> $1::vector LIMIT $k` — unfiltered (library side is global; there's only one corpus). Pass the embedding as a pgvector literal `'[0.1,...]'` (note: `[...]`, not Postgres `{...}`). ~~Add `CREATE INDEX ... USING hnsw (vector vector_cosine_ops)` as a manual edit in the migration~~ → deferred until retrieval is slow.
- [x] `packages/core/bm25.ts`: MiniSearch index cached per-process; built lazily on first `bm25Search` call, or eagerly via exported `rebuildBM25Index()` (with single-flight guard for concurrent callers). Analyzer calls `rebuildBM25Index()` at the top of each job so each analysis sees a fresh view of the library. **Phase 2 followup — cache invalidation across the staleness window:** during a long-running analysis job, library docs indexed mid-job remain invisible to BM25 until the next job. Vector search reads live from DB, so the two halves of hybrid retrieval can disagree. Production fix: indexer publishes `library:doc-indexed` on Redis pubsub when a doc transitions to `indexed`; analyzer's bm25 module subscribes and either (a) marks the cache dirty for the next `bm25Search` to rebuild, or (b) rebuilds eagerly on receipt. Either approach keeps per-job rebuild as a fallback safety net.
- [x] `packages/core/retrieval.ts`: `hybridSearch` runs vector + BM25 in parallel, fuses with Reciprocal Rank Fusion. **Fuse on rank position, not raw scores** (no normalization needed); handle docs appearing in only one list. Each backing search returns `k * 3` candidates to give RRF more material to fuse.
- [x] `packages/core/judge.ts`: ~~**Fan-out + LLM synthesis** (two exports: `evaluateChunk` + `synthesizeVerdicts`, Anthropic SDK tool-use via generic `callTool`, hand-rolled `zodToJsonSchema` + `tool_choice` + manual `safeParse`/retry)~~ → **Pivoted to single `judge(input)` per candidate document over AI SDK v6.** `generateStructured` in `packages/llm-clients/src/anthropic.ts` wraps `ai`'s `generateText` + `Output.object({ schema: VerdictSchema })`; the SDK handles tool conversion, response validation, and model-repair retries. XML-tagged user message (`<suspect_summary>`, `<candidate>`, `<evidence_pairs>` with per-pair `idx`+`score`). System prompt covers label semantics, confidence bands, and anti-patterns (shared terminology ≠ plagiarism). The fan-out/synthesis split — and the `ChunkFindingSchema`/`SynthesisBatchSchema` that landed in `cad9075` — were dropped along the way; only `VerdictSchema` + `EvidencePairSchema` remain on the judge side.
- [x] ~~`packages/core/report.ts`: pure `buildReport(candidates, verdicts)` returning structured data~~ → **deferred** (no consumer — `analyses.get` returns DB rows directly). Re-open when a summary view / export feature lands.
- [x] `apps/worker-analyzer/src/processor.ts`: ~~fan-out + synthesis flow~~ → **aggregate-evidence-per-doc flow**. `await rebuildBM25Index()` at job start. `hybridSearch(suspectChunk, 5)` for every suspect chunk in `Promise.all` (DB-only, fast). Aggregate hits into `Map<documentId, EvidenceSeed[]>`, pick top **5 candidate docs** by summed similarity, keep top **5 evidence pairs per candidate** (sorted desc). Sequential `for` loop over candidates (top-M=5, semaphore would buy nothing); per-candidate `db.verdict.findUnique` on `analysisJobId_candidateDocId` short-circuits before the LLM call; `db.verdict.create` with nested `evidence.create`, then `publishVerdict`. Suspect + candidate summaries are each document's chunk 0 — cheap, deterministic. Status walks `pending → parsing → searching → judging → done` (unchanged).

**Exit criteria**

- hybridSearch returns sensibly ranked candidates; vector-only and BM25-only paths each return results before fusion. ✓
- The judge's `tool_use` payload passes its Zod schema; a malformed mock triggers the repair/retry path.
- A plagiarized suspect → high-confidence "plagiarism"; an original → "no_match".

**Key files:** `packages/core/{vector-index,bm25,retrieval,judge}.ts`, `packages/llm-clients/src/anthropic.ts`, `apps/worker-analyzer/src/processor.ts`.

---

## M5 — Containerize the app tier + harden

**Tasks**

- [ ] Dockerfiles for api/workers/web; add to compose; env wiring; graceful shutdown.
- [ ] Error paths → `failed` status transitions; BullMQ job-failure / dead-letter handling; reconcile DB status for jobs orphaned mid-`parsing`/`embedding` on worker restart.
- [ ] `@fastify/static` for the SPA: register tRPC/SSE routes **before** the static catch-all and scope static to a prefix (the wildcard otherwise swallows API routes). Exclude SSE from any compression (`@fastify/compress` buffers and breaks streaming).
- [ ] Basic results UI matching the report structure (candidate cards by severity, evidence-pair tables, verdict badges).

**Exit criteria**

- `docker compose up` from a clean checkout runs the **entire** system end-to-end with real brains.
- Kill a worker mid-job, restart → resumes/retries without duplicate rows or corrupt status.

**Key files:** `apps/*/Dockerfile`, `docker-compose.yml`, `apps/api/src/server.ts`.

---

## Cross-cutting decisions to lock early

- **Asymmetric multi-tenancy — pick the side per query.** Library side (`Library`/`Document`/`Chunk`/`Embedding`) is global: no `orgId` column, no `orgId` filter in vector / BM25 / SQL. Analysis side (`Suspect`/`AnalysisJob`/`Verdict`) is per-org: every read and write filters by `ctx.orgId`. Inject the hardcoded default org via tRPC context — never hardcode it inside queries. Unique constraints follow the same split: `@@unique([contentHash])` on library-side rows, `@@unique([orgId, …])` on analysis-side rows (if added later). Suspect uploads never become Library Documents, so there's no cross-side write path that could leak one tenant's text into the shared corpus.
- **Zod is the single source of truth.** `VerdictSchema` in `packages/schemas` generates the Anthropic tool schema, validates the response, types the Prisma write, and types the tRPC output. Regenerate the tool JSON schema from the Zod object so drift is impossible.
- **The only thing crossing api → web is the erasable `AppRouter` type.** Workers never import from `apps/api`; they share via `packages/schemas` + `packages/db`.
- **Single AWS S3 client config.** `apps/api` (presigned URL signing) and the workers (`GetObject`) share one `S3Client` instance per region. No endpoint override, no `forcePathStyle`. Pin `Content-Type` at sign time and have the browser send exactly that (mismatch → 403). Configure CORS on the bucket in the AWS console (`AllowedOrigins`: web origin; `AllowedMethods`: `PUT`/`GET`/`HEAD`; expose `ETag`).
- **Deterministic `jobId`** (documentId / analysisJobId) so double `confirmUpload` is deduped. ioredis connection needs `maxRetriesPerRequest: null` or BullMQ won't start.
- **unpdf in Docker:** verify it runs headless in the slim Node image (test inside the container at M3, not just on macOS).

---

## Verification (end-to-end, per `production-plan.md`)

1. `docker compose up` — all services start; health endpoints 200.
2. Upload the library PDFs through the UI; each transitions `pending → parsing → embedding → indexed`; confirm Embedding/BM25 entries exist.
3. Upload the paraphrased suspect via `/analyze`; the result page receives streamed verdicts via SSE.
4. Compare rendered verdicts (labels, confidence, evidence pairs) against the prototype's reference report — functionally identical within Claude's nondeterminism.
5. Kill `worker-indexer` mid-job, restart → idempotent resume (no duplicate Embedding rows for the same `chunkId + contentHash`).
6. `npm run typecheck`, `npm test` (unit tests for `packages/core`), `npm run lint` all pass at the root (each delegating to `turbo`).
7. _(When the prototype lands)_ PDF-extraction parity test: fixture comparing `unpdf` output against the prototype's extraction; flag for the Phase 2 Python-sidecar fallback if the diff exceeds an agreed threshold.

## Out of scope (later phases)

Hosted deploy + Pino/Sentry/Bull Board (Phase 2); OpenSearch/Qdrant (Phase 3); centralized outbound rate-limit gateway (Phase 4); auth, prompt-injection defenses, PDF sandbox, OTel, GDPR deletion (Phase 5).
