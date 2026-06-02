import { requireEnv } from "@repo/config/env";
import { verdictChannel } from "@repo/schemas";
import IORedis from "ioredis";

const redisUrl = requireEnv("REDIS_URL");

// Dedicated connection for fire-and-forget PUBLISH. Kept separate from the
// BullMQ worker connection (queues.ts) because the concerns differ:
//   - queues.ts holds blocking commands and needs maxRetriesPerRequest: null
//   - pub/sub PUBLISH is non-blocking and uses ioredis defaults
// A subscriber lives in apps/api (Task 4 SSE) on its own connection — once
// a client SUBSCRIBEs, that connection is locked to subscriber mode.
export const publisher = new IORedis(redisUrl);

export async function publishVerdict(
  analysisJobId: string,
  payload: unknown,
): Promise<void> {
  await publisher.publish(
    verdictChannel(analysisJobId),
    JSON.stringify(payload),
  );
}
