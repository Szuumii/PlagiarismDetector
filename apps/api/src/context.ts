import { requireEnv } from "@repo/config/env";
import { db } from "@repo/db";

import { analyzeSuspectQueue, connection, indexDocumentQueue } from "./queues";

const orgId = requireEnv("DEFAULT_ORG_ID");

export function createContext() {
  return {
    orgId,
    db,
    redis: connection,
    queues: {
      indexDocument: indexDocumentQueue,
      analyzeSuspect: analyzeSuspectQueue,
    },
  };
}

export type Context = ReturnType<typeof createContext>;
