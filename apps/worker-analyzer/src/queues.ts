import { requireEnv } from "@repo/config/env";
import IORedis from "ioredis";

// Duplicated from apps/api/src/queues.ts on purpose — workers don't import
// from apps/api (CLAUDE.md). Promote to a shared package if these names grow.
export const QUEUE_NAMES = {
  analyzeSuspect: "analyze-suspect",
} as const;

const redisUrl = requireEnv("REDIS_URL");

// Workers need their own connection — BullMQ's blocking commands partition
// badly when shared with non-blocking producers. maxRetriesPerRequest: null
// is the CLAUDE.md-mandated BullMQ requirement.
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});
