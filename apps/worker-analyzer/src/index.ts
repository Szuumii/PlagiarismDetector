import { db } from "@repo/db";
import { AnalyzeSuspectJobSchema } from "@repo/schemas";
import { Worker } from "bullmq";

import { processAnalyzeSuspect } from "./processor";
import { connection, QUEUE_NAMES } from "./queues";

const worker = new Worker(
  QUEUE_NAMES.analyzeSuspect,
  processAnalyzeSuspect,
  { connection },
);

worker.on("completed", (job) => {
  console.log(`[analyzer] completed jobId=${job.id}`);
});

worker.on("failed", async (job, err) => {
  console.error(`[analyzer] failed jobId=${job?.id} msg=${err.message}`);
  if (!job) return;

  // job.data is unverified JSON from Redis — the original throw might have
  // been the schema parse itself, in which case there's no analysisJobId
  // we can trust. safeParse defensively.
  const parsed = AnalyzeSuspectJobSchema.safeParse(job.data);
  if (!parsed.success) return;

  try {
    await db.analysisJob.update({
      where: { id: parsed.data.analysisJobId },
      data: {
        status: "failed",
        error: err.message,
        completedAt: new Date(),
      },
    });
  } catch (statusErr) {
    console.error(
      `[analyzer] could not mark analysisJob failed for ${parsed.data.analysisJobId}:`,
      statusErr,
    );
  }
});

const shutdown = async () => {
  console.log("[analyzer] shutting down...");
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[analyzer] worker started, queue: ${QUEUE_NAMES.analyzeSuspect}`);
