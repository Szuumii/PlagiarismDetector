import { extractText, hybridSearch, judge } from "@repo/core";
import { db } from "@repo/db";
import { AnalyzeSuspectJobSchema, type AnalyzeSuspectJob } from "@repo/schemas";
import { storage } from "@repo/storage";
import type { Job } from "bullmq";

import { publishVerdict } from "./pubsub";

export async function processAnalyzeSuspect(job: Job<AnalyzeSuspectJob>): Promise<void> {
  const { orgId, analysisJobId, objectKey } = AnalyzeSuspectJobSchema.parse(job.data);
  console.log(`[analyzer] start analysisJobId=${analysisJobId}`);

  await db.analysisJob.update({ where: { id: analysisJobId }, data: { status: "parsing", startedAt: new Date() } })

  const buffer = await storage.getObject(objectKey);
  const suspectText = await extractText(buffer);

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "searching" },
  });

  const hits = await hybridSearch(suspectText, 5);

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "judging" },
  });

  let verdictsWritten = 0;

  for (const hit of hits) {
    const exisits = await db.verdict.findUnique({
      where: {
        analysisJobId_candidateDocId: {
          analysisJobId,
          candidateDocId: hit.documentId,
        },
      },
    });
    if (exisits) {
      continue;
    }

    const candidate = await db.document.findUnique({
      where: { id: hit.documentId },
    });

    if (!candidate) {
      console.warn(`[analyzer] candidate ${hit.documentId} not found; skipping`);
      continue;
    }

    const verdict = await judge(suspectText, {
      id: candidate.id,
      content: candidate.title,
    });

    const row = await db.verdict.create({
      data: {
        orgId,
        analysisJobId,
        candidateDocId: hit.documentId,
        label: verdict.label,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
        searchScore: hit.score,
        evidence: {
          create: verdict.evidence.map((e, pairIndex) => ({
            pairIndex,
            suspectText: e.suspectText,
            sourceText: e.sourceText,
            note: e.note,
          })),
        },
      },
      include: { evidence: true },
    });

    await publishVerdict(analysisJobId, row);

    verdictsWritten++;
    console.log(
      `[analyzer] verdict written candidate=${hit.documentId} label=${verdict.label}`,
    );
  }

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "done", completedAt: new Date() },
  });
  console.log(
    `[analyzer] done analysisJobId=${analysisJobId} verdicts=${verdictsWritten}`,
  );
}
