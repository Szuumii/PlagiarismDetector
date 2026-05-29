# Plagiarism Detector

Academic plagiarism detection pipeline built on TypeScript. Upload reference PDFs to a library, submit a suspect document, and receive streamed verdicts with evidence — powered by Voyage embeddings and Claude as the judge.

## How it works

1. **Index** — reference PDFs are chunked, embedded via Voyage `voyage-3-large`, and stored in Postgres with pgvector.
2. **Retrieve** — suspect chunks are matched against the library using hybrid search (vector + BM25 via Reciprocal Rank Fusion).
3. **Judge** — Claude evaluates each candidate pair and returns a structured verdict (verbatim, paraphrase, legitimate reuse, or no match).
4. **Stream** — verdicts arrive in the browser progressively over SSE as each candidate is judged.

## Stack

| Layer | Technology |
|---|---|
| API | Fastify + tRPC v11 |
| Frontend | React + Vite + React Router |
| Queue | BullMQ + Redis |
| Database | Postgres + pgvector (Prisma) |
| Object storage | SeaweedFS (S3-compatible) |
| Embeddings | Voyage `voyage-3-large` |
| Judge | Anthropic Claude (tool-use) |

Monorepo managed with npm workspaces + Turborepo.

## Prerequisites

- Node.js >= 20
- Docker (for Postgres, Redis, SeaweedFS)
- Voyage API key
- Anthropic API key

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
# Fill in VOYAGE_API_KEY and ANTHROPIC_API_KEY
```

**3. Start infrastructure**

```bash
docker compose up -d
```

**4. Run database migrations**

```bash
npm run db:migrate -w @repo/db
```

**5. Start all services**

```bash
npm run dev
```

This starts the API server (`:3001`), both workers, and the Vite dev server (`:5173`) concurrently via Turborepo.

## Project structure

```
apps/
  api/               Fastify + tRPC server, presigned upload URLs, SSE subscriptions
  web/               React SPA — library management, suspect upload, results page
  worker-indexer/    BullMQ worker — PDF extract, chunk, embed, store
  worker-analyzer/   BullMQ worker — hybrid search, Claude judge, stream verdicts
packages/
  core/              Pure pipeline modules (pdf, chunking, embeddings, retrieval, judge)
  db/                Prisma schema and client
  schemas/           Shared Zod schemas (verdicts, job payloads)
  llm-clients/       Voyage and Anthropic wrappers
  config/            Shared tsdown, ESLint, and Prettier config
docs/
  production-plan.md          Target architecture and design decisions
  phase-1-implementation-plan.md  Milestone-by-milestone build guide
```

## Documentation

See [`docs/production-plan.md`](docs/production-plan.md) for the full architecture and design decisions, and [`docs/phase-1-implementation-plan.md`](docs/phase-1-implementation-plan.md) for the milestone-by-milestone implementation guide.
