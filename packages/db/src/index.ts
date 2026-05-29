import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});

// Single Prisma entry point for the monorepo: re-export the generated model
// types, enums, and the `Prisma` namespace so consumers depend only on @repo/db.
export * from "@prisma/client";
