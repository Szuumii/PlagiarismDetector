import { db } from "@repo/db";
import { IndexDocumentJobSchema } from "@repo/schemas";
import { Worker } from "bullmq";

import { processIndexDocument } from "./processor";
import { connection, QUEUE_NAMES } from "./queues";

const worker = new Worker(QUEUE_NAMES.indexDocument, processIndexDocument, {
  connection,
});

worker.on("completed", (job) => {
  console.log(`[indexer] completed jobId=${job.id}`);
});

worker.on("failed", async (job, err) => {
  console.error(`[indexer] failed jobId=${job?.id} msg=${err.message}`);
  if (!job) return;

  // job.data is unverified JSON from Redis — the original throw might have
  // been the schema parse itself, in which case there's no documentId we
  // can trust. safeParse defensively.
  const parsed = IndexDocumentJobSchema.safeParse(job.data);
  if (!parsed.success) return;

  try {
    await db.document.update({
      where: { id: parsed.data.documentId },
      data: { status: "failed" },
    });
  } catch (statusErr) {
    console.error(
      `[indexer] could not mark document failed for ${parsed.data.documentId}:`,
      statusErr,
    );
  }
});

const shutdown = async () => {
  console.log("[indexer] shutting down...");
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[indexer] worker started, queue: ${QUEUE_NAMES.indexDocument}`);
