import { Queue } from "bullmq";
import IORedis from "ioredis";
import { requireEnv } from "@repo/config/env";

export const QUEUE_NAMES = {
  indexDocument: "index-document",
  analyzeSuspect: "analyze-suspect",
} as const;

const redisUrl = requireEnv("REDIS_URL");

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const indexDocumentQueue = new Queue(QUEUE_NAMES.indexDocument, {
  connection,
});

export const analyzeSuspectQueue = new Queue(QUEUE_NAMES.analyzeSuspect, {
  connection,
});
