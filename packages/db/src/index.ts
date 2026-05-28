import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Reuse one PrismaClient per process. A fresh client on every import (or on each
// `tsx watch` restart in dev) would open a new connection pool and exhaust
// Postgres, so cache the instance on globalThis outside production.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Single Prisma entry point for the monorepo: re-export the generated model
// types, enums, and the `Prisma` namespace so consumers depend only on @repo/db.
export * from "@prisma/client";
