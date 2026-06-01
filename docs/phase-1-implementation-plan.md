# Phase 1 Implementation Plan — Plagiarism Detector (TypeScript MVP)

## Context

`production-plan.md` describes migrating a proven four-stage pipeline (chunk → embed → hybrid retrieve → LLM-as-judge) from a Python notebook prototype into a production TypeScript stack. **Phase 1** is the deployable single-node MVP: a library admin uploads reference PDFs into a single shared library, a user submits a suspect PDF, the system asynchronously indexes/retrieves/judges against that shared library, and the UI streams progressive verdicts. Single Docker Compose, no auth, hardcoded default org — but **asymmetric multi-tenancy from day 1** (library side global, analysis side per-org — see `production-plan.md` key decision #2) and **async from day 1** (indexing takes minutes; HTTP can't carry it).

This document is the *implementation* plan: an ordered, milestone-based build sequence the user will execute with Claude's help. It deliberately keeps prototype references generic — the user will wire in the actual notebook logic, chunking params, RRF constant, judge prompt, and PDF fixtures as they go.

**Repo state:** greenfield (only `README.md`, `architecture.excalidraw`, `production-plan.md`). The notebook and PDFs are *not* in the repo yet; the user adds them during implementation.

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
- [x] Model the vector column as `Unsupported("vector(1024)")` on `Embedding` (Prisma has no native vector type — it is *not* readable/writable through the typed client; all vector I/O is raw SQL).
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
> **Deferred:** real `contentHash` dedupe on Document — column exists (`@unique`, nullable), populated by the worker in M3. AnalysisJob → done/failed cleanup paths land in M5.

**Tasks**
- [x] Upload flow: `library.documents.create` → presigned S3 PUT URL → browser uploads directly → `confirmUpload` → enqueue `IndexDocumentJob`. Same shape for `analyses.create`/`confirmUpload` → `AnalyzeSuspectJob`.
- [ ] `worker-indexer`: real S3 download + real `Chunk`/`Embedding` upserts + real `Document.status` transitions; **fake** extract (constant string), **fake** chunk (split on `\n\n`), **fake** embed (constant 1024-vector).
- [ ] `worker-analyzer`: real `Verdict`/`EvidencePair` writes + real status transitions; **fake** hybridSearch (return the one indexed doc) and **fake** judge (hardcoded valid `VerdictSchema` object).
- [ ] `analyses.subscribe` SSE: **Redis pub/sub** for the per-verdict stream + **BullMQ `QueueEvents`** for coarse status (searching/judging/done). On subscription start, **replay existing Verdict rows from the DB, then switch to live pub/sub**, deduping by verdict id (handles late joiners / fast jobs).
- [ ] Minimal UI: upload a library doc, upload a suspect, watch a verdict stream in without a refresh.

**Exit criteria**
- From the browser: upload one PDF, upload one suspect, see a (fake) verdict appear via SSE — no manual refresh.
- Document: `pending→…→indexed`; AnalysisJob: `pending→…→done` in the DB.
- Re-running the index job produces **no duplicate** Chunk/Embedding rows (idempotency proven on fake data — easier now than later).

**Key files:** `apps/api/src/routers/*`, `apps/worker-indexer/src/index.ts`, `apps/worker-analyzer/src/index.ts`, `apps/api/src/subscriptions`.

---

## M3 — Real ingestion: PDF extract + chunking + Voyage embeddings

**Tasks**
- [ ] `packages/core/pdf.ts`: `extractText` via `unpdf`, strip trailing References/Bibliography block.
- [ ] `packages/core/chunking.ts`: paragraph split with sentence-level fallback for long paragraphs.
- [ ] `packages/core/embeddings.ts` + `voyage.ts`: `voyage-3-large`, `input_type: "document"`, batched `fetch`, returns `number[][]`. **Assert `embedding.length === 1024`** before insert (Voyage output dim is configurable; a mismatch throws on the `vector(1024)` insert).
- [ ] Real `contentHash` on Document + Chunk; **skip the Voyage call entirely** when a Chunk/Embedding with that hash already exists (makes retries cheap *and* idempotent).
- [ ] Rate limiting: token-bucket **inside `voyage.ts`** (one index job makes N calls; the BullMQ limiter only throttles job *starts*, not internal API calls). BullMQ worker `limiter: { max: 3, duration: 60000 }` is the secondary guard.

**Exit criteria**
- A real academic PDF indexes end-to-end; Embedding rows hold genuine 1024-dim vectors.
- Re-indexing the same PDF skips all rows (hash hits) and makes no Voyage calls.
- The in-client limiter visibly paces requests without failing the job.

**Key files:** `packages/core/{pdf,chunking,embeddings}.ts`, `packages/llm-clients/voyage.ts`.

---

## M4 — Real retrieval + real judge

**Tasks**
- [ ] `packages/core/vector-index.ts`: raw-SQL `searchVector` with `ORDER BY vector <=> $1::vector LIMIT $k` — unfiltered (library side is global; there's only one corpus). Pass the embedding as a pgvector literal `'[0.1,...]'` (note: `[...]`, not Postgres `{...}`). Add `CREATE INDEX ... USING hnsw (vector vector_cosine_ops)` as a manual edit in the migration (op class must match the `<=>` cosine operator).
- [ ] `packages/core/bm25.ts`: MiniSearch rebuilt from DB rows on worker startup, cached per process. **Add a rebuild trigger / rebuild-on-job-start** — a doc indexed after the analyzer started is invisible to BM25 until rebuilt (vector search reads live from DB, so the two halves can disagree).
- [ ] `packages/core/retrieval.ts`: `hybridSearch` runs vector + BM25 in parallel, fuses with Reciprocal Rank Fusion. **Fuse on rank position, not raw scores** (no normalization needed); handle docs appearing in only one list.
- [ ] `packages/core/judge.ts`: Anthropic SDK tool-use. `zodToJsonSchema(VerdictSchema)` with refs inlined and `$schema` stripped (Anthropic rejects `$ref`/`definitions`); `tool_choice: { type: "tool", name }` to force the call; find the `tool_use` block by type+name (not index 0); **`VerdictSchema.safeParse` the response**, retry-with-error-fed-back once on failure. Cache the generated JSON schema (it's pure).
- [ ] `packages/core/report.ts`: pure `buildReport(candidates, verdicts)` returning structured data (no HTML — that lives in the frontend).
- [ ] Swap the M2 fakes in `worker-analyzer` for these real modules.

**Exit criteria**
- hybridSearch returns sensibly ranked candidates; vector-only and BM25-only paths each return results before fusion.
- The judge's `tool_use` payload passes `VerdictSchema.parse`; a malformed mock triggers the repair/retry path.
- A plagiarized suspect → high-confidence "plagiarism"; an original → "no_match".

**Key files:** `packages/core/{vector-index,bm25,retrieval,judge,report}.ts`, `packages/llm-clients/anthropic.ts`.

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
7. *(When the prototype lands)* PDF-extraction parity test: fixture comparing `unpdf` output against the prototype's extraction; flag for the Phase 2 Python-sidecar fallback if the diff exceeds an agreed threshold.

## Out of scope (later phases)

Hosted deploy + Pino/Sentry/Bull Board (Phase 2); OpenSearch/Qdrant (Phase 3); centralized outbound rate-limit gateway (Phase 4); auth, prompt-injection defenses, PDF sandbox, OTel, GDPR deletion (Phase 5).
