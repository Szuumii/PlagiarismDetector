import { defineConfig } from "prisma/config";

// DATABASE_URL is sourced from the repo-root `.env` by the Makefile
// (`set -a; . ./.env; set +a; npm run db:migrate -w @repo/db`). We use
// `process.env` rather than the `env()` helper so commands that don't
// need a live connection (e.g. `prisma generate`) don't fail when it's unset.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: 'tsx prisma/seed.ts',
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
