import {
  chunk,
  extractText,
  hybridSearch,
  judge,
  rebuildBM25Index,
  type JudgeInput,
} from "@repo/core";
import { db } from "@repo/db";
import { AnalyzeSuspectJobSchema, type AnalyzeSuspectJob } from "@repo/schemas";
import { storage } from "@repo/storage";
import type { Job } from "bullmq";

import { publishVerdict } from "./pubsub";

const TOP_M_CANDIDATES = 5;
const TOP_PAIRS_PER_CANDIDATE = 5;

interface EvidenceSeed {
  suspectChunkIdx: number;
  libraryChunkId: string;
  score: number;
}

interface CandidateAggregate {
  documentId: string;
  aggregateScore: number;
  evidenceSeeds: EvidenceSeed[];
}

export async function processAnalyzeSuspect(
  job: Job<AnalyzeSuspectJob>,
): Promise<void> {
  const { orgId, analysisJobId, objectKey } = AnalyzeSuspectJobSchema.parse(
    job.data,
  );
  console.log(`[analyzer] start analysisJobId=${analysisJobId}`);

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "parsing", startedAt: new Date() },
  });

  const buffer = await storage.getObject(objectKey);
  const suspectText = await extractText(buffer);
  const suspectChunks = chunk(suspectText);

  console.log(
    `[analyzer] suspect parsed: ${suspectChunks.length} chunks`,
  );

  await rebuildBM25Index();

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "searching" },
  });

  const retrievals = await Promise.all(
    suspectChunks.map(async (c, suspectChunkIdx) => ({
      suspectChunkIdx,
      hits: await hybridSearch(c.content, 5),
    })),
  );

  console.log(
    `[analyzer] retrieved hits for ${retrievals.length} suspect chunks`,
  );

  const byDocId = new Map<string, EvidenceSeed[]>();
  for (const { suspectChunkIdx, hits } of retrievals) {
    for (const hit of hits) {
      const seed: EvidenceSeed = {
        suspectChunkIdx,
        libraryChunkId: hit.chunkId,
        score: hit.score,
      };
      const existing = byDocId.get(hit.documentId);
      if (existing) {
        existing.push(seed);
      } else {
        byDocId.set(hit.documentId, [seed]);
      }
    }
  }

  const candidates: CandidateAggregate[] = [...byDocId.entries()]
    .map(([documentId, seeds]) => ({
      documentId,
      aggregateScore: seeds.reduce((sum, s) => sum + s.score, 0),
      evidenceSeeds: [...seeds]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_PAIRS_PER_CANDIDATE),
    }))
    .sort((a, b) => b.aggregateScore - a.aggregateScore)
    .slice(0, TOP_M_CANDIDATES);

  console.log(
    `[analyzer] aggregated ${candidates.length} candidate docs from retrievals`,
  );

  const topDocIds = candidates.map((c) => c.documentId);
  const allMatchedChunkIds = [
    ...new Set(
      candidates.flatMap((c) =>
        c.evidenceSeeds.map((s) => s.libraryChunkId),
      ),
    ),
  ];

  const docRows = await db.document.findMany({
    where: { id: { in: topDocIds } },
    select: {
      id: true,
      title: true,
      chunks: {
        where: {
          OR: [{ chunkIdx: 0 }, { id: { in: allMatchedChunkIds } }],
        },
        select: { id: true, chunkIdx: true, content: true },
      },
    },
  });

  const docContext = new Map<
    string,
    { title: string; summary: string; chunkContent: Map<string, string> }
  >();

  for (const doc of docRows) {
    const firstChunk = doc.chunks.find((c) => c.chunkIdx === 0);
    docContext.set(doc.id, {
      title: doc.title,
      summary: firstChunk?.content ?? "",
      chunkContent: new Map(doc.chunks.map((c) => [c.id, c.content])),
    });
  }

  console.log(
    `[analyzer] fetched context for ${docContext.size}/${candidates.length} candidate docs`,
  );

  const suspectSummary = suspectChunks[0]?.content ?? "";

  const judgeJobs: Array<{
    documentId: string;
    aggregateScore: number;
    input: JudgeInput;
  }> = [];

  for (const c of candidates) {
    const ctx = docContext.get(c.documentId);
    if (!ctx) {
      console.warn(
        `[analyzer] missing context for candidate ${c.documentId}, skipping`,
      );
      continue;
    }

    const evidencePairs = c.evidenceSeeds.flatMap((seed) => {
      const suspectText = suspectChunks[seed.suspectChunkIdx]?.content;
      const sourceText = ctx.chunkContent.get(seed.libraryChunkId);
      if (!suspectText || !sourceText) return [];
      return [{ suspectText, sourceText, score: seed.score }];
    });

    if (evidencePairs.length === 0) {
      console.warn(
        `[analyzer] no usable evidence pairs for candidate ${c.documentId}, skipping`,
      );
      continue;
    }

    judgeJobs.push({
      documentId: c.documentId,
      aggregateScore: c.aggregateScore,
      input: {
        suspectSummary,
        candidate: {
          documentId: c.documentId,
          title: ctx.title,
          summary: ctx.summary,
          evidencePairs,
        },
      },
    });
  }

  console.log(
    `[analyzer] prepared ${judgeJobs.length} judge inputs from ${candidates.length} candidates`,
  );

  await db.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: "judging" },
  });

  let verdictsWritten = 0;

  for (const job of judgeJobs) {
    const existing = await db.verdict.findUnique({
      where: {
        analysisJobId_candidateDocId: {
          analysisJobId,
          candidateDocId: job.documentId,
        },
      },
    });
    if (existing) {
      console.log(
        `[analyzer] verdict already exists candidate=${job.documentId}, skipping`,
      );
      continue;
    }

    const verdict = await judge(job.input);

    const persisted = await db.verdict.create({
      data: {
        orgId,
        analysisJobId,
        candidateDocId: job.documentId,
        label: verdict.label,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
        searchScore: job.aggregateScore,
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

    await publishVerdict(analysisJobId, persisted);

    verdictsWritten += 1;
    console.log(
      `[analyzer] verdict written candidate=${job.documentId} label=${verdict.label} confidence=${verdict.confidence}`,
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
