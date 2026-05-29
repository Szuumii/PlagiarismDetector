# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package manager

**npm** (not pnpm). Use `npm install`, `npm run <script>`, `npx <bin>`. Workspace deps reference each other as `"@repo/pkg": "*"` — npm has no `workspace:` protocol.

## Common commands

```bash
# Install all workspace dependencies
npm install

# Start everything for development (all packages watch, all apps run)
npm run dev

# Build all packages in dependency order
npm run build

# Type-check all packages
npm run typecheck

# Lint all packages
npm run lint

# Format all files
npm run format

# Prisma — run from repo root
npm run db:generate -w @repo/db    # regenerate client after schema changes
npm run db:migrate -w @repo/db     # apply migrations (requires DATABASE_URL)
npm run db:studio -w @repo/db      # open Prisma Studio

# Run tests in packages/core only (the only testable package)
npm test -w @repo/core
```

All `build`, `typecheck`, and `lint` commands delegate to Turborepo, which runs them in dependency order.

## Architecture

Four processes communicate through Redis and Postgres:

```
Browser → apps/web (Vite SPA)
            ↕ tRPC + SSE
         apps/api (Fastify)
            ↕ BullMQ queues (Redis)
         apps/worker-indexer   apps/worker-analyzer
            ↕                         ↕
         Postgres + pgvector      AWS S3
```

**`apps/api`** — Fastify server with tRPC adapter. Owns presigned S3 upload URLs, enqueues BullMQ jobs, and streams verdict updates via SSE (Redis pub/sub + BullMQ QueueEvents). Exports *only* `AppRouter` as a type — never a runtime value.

**`apps/web`** — Static React SPA (Vite). Imports `AppRouter` with `import type { AppRouter } from "api"` for end-to-end tRPC type safety. No server runtime.

**`apps/worker-indexer`** — Consumes `index-document` queue. Downloads PDF from S3 → extract → chunk → embed (Voyage) → upsert `Chunk`/`Embedding` rows.

**`apps/worker-analyzer`** — Consumes `analyze-suspect` queue. Downloads suspect PDF → hybrid search (vector + BM25) → Claude judge per candidate → streams `Verdict` rows via Redis pub/sub as each completes.

**`packages/schemas`** — Single source of truth for all shared Zod schemas. `VerdictSchema` is reused as the Anthropic tool definition, response validator, Prisma write adapter, and tRPC response type. Nothing shared between apps/packages should be defined outside this package.

**`packages/db`** — Prisma client singleton and schema. `build` runs `prisma generate` before compiling. Vector column is typed as `Unsupported("vector(1024)")` — all vector I/O must use raw SQL (`$queryRaw`/`$executeRaw`).

**`packages/core`** — Pure pipeline modules: `pdf`, `chunking`, `embeddings`, `vector-index`, `bm25`, `retrieval`, `judge`, `report`. No Fastify/BullMQ dependencies. Unit-testable in isolation.

**`packages/llm-clients`** — Voyage and Anthropic wrappers. Generates Anthropic tool JSON schema from `VerdictSchema` via `zod-to-json-schema`.

## TypeScript setup

- `module: "Preserve"` + `moduleResolution: "Bundler"` everywhere — no `.js` extensions needed in imports.
- `verbatimModuleSyntax: true` — type-only imports **must** use `import type`.
- Within-package alias: `@/` → `./src/` (configured in each `tsconfig.json` via `paths`).
- Cross-package alias: `@repo/<name>` resolves via npm workspaces to `packages/<name>/dist/`.

## Build tooling

- **Library packages** (`@repo/schemas`, `@repo/db`, `@repo/core`, `@repo/llm-clients`): built with `tsdown` (Rolldown-based). Shared config factory in `packages/config/tsdown.ts` — import with `createTsdownConfig()`. Apps pass `{ dts: false }`.
- **Apps** (`api`, `worker-*`): `tsdown` for production builds; `tsx watch` for dev (runs the process directly, no compilation to disk).
- **Web**: Vite for both dev and build. `@/` alias configured in `vite.config.ts` via `resolve.alias`.

During `npm run dev`, library packages run `tsdown --watch` (rebuilding `dist/` on change) while apps run `tsx watch` (process restarts on change). Apps import from packages' `dist/` — packages must be built or watching before apps start.

## Key constraints

- **`orgId` on every model and query** — schema is multi-tenant from day one even though Phase 1 hardcodes a default org. Never scope a query without `orgId`.
- **Single AWS S3 client config** — `apps/api` (presigned URL signing) and the workers (`GetObject`) share one `S3Client` instance per region. No endpoint override, no `forcePathStyle`. Bucket name + IAM credentials come from `.env` (locally) or an attached IAM role (in prod). The bucket is provisioned out-of-band in the AWS console — the API does not bootstrap it. Sign presigned PUTs with `ContentType: "application/pdf"` and have the browser send exactly that header (mismatch → 403). Bucket CORS must allow the web origin + `PUT`/`GET`/`HEAD` and expose `ETag`.
- **ioredis** connections require `maxRetriesPerRequest: null` for BullMQ to start.
- **Prisma pgvector**: pass embeddings as a literal string `'[0.1,0.2,...]'::vector` in raw SQL — the `Unsupported` type is not readable/writable through the typed Prisma client.
- **Idempotency**: all worker jobs must be re-runnable without duplicating rows — use `contentHash` unique constraints and upsert patterns.
