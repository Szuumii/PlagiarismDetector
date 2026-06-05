import { z } from "zod";

// ── Verdict ────────────────────────────────────────────────────────────────
// The single source of truth reused as the Anthropic tool definition, the
// response validator, the Prisma write shape, and the tRPC response type.

export const VerdictLabelSchema = z.enum(["plagiarism", "paraphrase", "no_match"]);
export type VerdictLabel = z.infer<typeof VerdictLabelSchema>;

export const EvidencePairSchema = z.object({
  suspectText: z.string(),
  sourceText: z.string(),
  note: z.string(),
});
export type EvidencePair = z.infer<typeof EvidencePairSchema>;

export const VerdictSchema = z.object({
  label: VerdictLabelSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  evidence: z.array(EvidencePairSchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;

// ── Queue job payloads ───────────────────────────────────────────────────────
// orgId is per-org for the analysis side (AnalyzeSuspectJob); the library side
// (IndexDocumentJob) is global and carries no orgId.

export const IndexDocumentJobSchema = z.object({
  documentId: z.string().uuid(),
  objectKey: z.string().min(1),
});
export type IndexDocumentJob = z.infer<typeof IndexDocumentJobSchema>;

export const AnalyzeSuspectJobSchema = z.object({
  orgId: z.string().uuid(),
  analysisJobId: z.string().uuid(),
  objectKey: z.string().min(1),
});
export type AnalyzeSuspectJob = z.infer<typeof AnalyzeSuspectJobSchema>;

// ── Upload procedure I/O ─────────────────────────────────────────────────────
// Shared shape: every create-procedure returns a presigned PUT URL alongside
// the new entity's id. The create-response schemas extend this fragment.

export const PresignedUploadSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;

export const CreateDocumentInputSchema = z.object({
  title: z.string().min(1),
  filename: z.string().endsWith(".pdf"),
});
export type CreateDocumentInput = z.infer<typeof CreateDocumentInputSchema>;

export const CreateDocumentResponseSchema = PresignedUploadSchema.extend({
  documentId: z.string().uuid(),
});
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponseSchema>;

export const ConfirmDocumentUploadInputSchema = z.object({
  documentId: z.string().uuid(),
});
export type ConfirmDocumentUploadInput = z.infer<
  typeof ConfirmDocumentUploadInputSchema
>;

export const ConfirmDocumentUploadResponseSchema = z.object({
  enqueued: z.literal(true),
  jobId: z.string().uuid()
})
export type ConfirmDocumentUploadResponse = z.infer<typeof ConfirmDocumentUploadResponseSchema>

export const CreateAnalysisInputSchema = z.object({
  filename: z.string().endsWith(".pdf"),
});
export type CreateAnalysisInput = z.infer<typeof CreateAnalysisInputSchema>;

export const CreateAnalysisResponseSchema = PresignedUploadSchema.extend({
  suspectId: z.string().uuid(),
});
export type CreateAnalysisResponse = z.infer<typeof CreateAnalysisResponseSchema>;

export const ConfirmAnalysisUploadInputSchema = z.object({
  suspectId: z.string().uuid(),
});
export type ConfirmAnalysisUploadInput = z.infer<
  typeof ConfirmAnalysisUploadInputSchema
>;
export const ConfirmAnalysisUploadResponseSchema = z.object({
  analysisJobId: z.string().uuid(),
})
export type ConfirmAnalysisUploadResponse = z.infer<typeof ConfirmAnalysisUploadResponseSchema>

// ── Pub/sub channel conventions ──────────────────────────────────────────────
// Shared between the worker-analyzer (publisher) and apps/api (SSE subscriber,
// Task 4). Single source of truth so the channel format can't drift.

export function verdictChannel(analysisJobId: string): string {
  return `verdicts:${analysisJobId}`;
}

// ── Analysis read-side ───────────────────────────────────────────────────────
// `analyses.get` returns the AnalysisJob's current state plus all verdicts
// written so far. UI polls this until status is terminal (done | failed).
// SSE is deferred — see plan §M2 Task 4.

export const AnalysisStatusSchema = z.enum([
  "pending",
  "parsing",
  "searching",
  "judging",
  "done",
  "failed",
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const GetAnalysisInputSchema = z.object({
  analysisJobId: z.string().uuid(),
});
export type GetAnalysisInput = z.infer<typeof GetAnalysisInputSchema>;

const VerdictWithEvidenceSchema = z.object({
  id: z.string().uuid(),
  candidateDocId: z.string().uuid(),
  label: VerdictLabelSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  searchScore: z.number(),
  evidence: z.array(
    z.object({
      pairIndex: z.number().int().nonnegative(),
      suspectText: z.string(),
      sourceText: z.string(),
      note: z.string(),
    }),
  ),
});

export const GetAnalysisResponseSchema = z.object({
  id: z.string().uuid(),
  status: AnalysisStatusSchema,
  error: z.string().nullable(),
  // ISO strings on the wire — no superjson transformer configured, so
  // Date objects would lose typing across the api → web boundary. Convert
  // explicitly in the procedure.
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  verdicts: z.array(VerdictWithEvidenceSchema),
});
export type GetAnalysisResponse = z.infer<typeof GetAnalysisResponseSchema>;

export const SuspicionLevelSchema = z.enum(["high", "medium", "low", "none"]);
export type SuspicionLevel = z.infer<typeof SuspicionLevelSchema>;

export const ChunkEvaluationSchema = z.object({
  candidateIdx: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Zero-indexed position of the candidate in the input list presented to you.",
    ),
  suspicion: SuspicionLevelSchema.describe(
    "'high' = verbatim or near-verbatim copy of the suspect passage. 'medium' = clear paraphrase or substantial semantic reuse. 'low' = mild similarity that is most likely coincidence. 'none' = unrelated content.",
  ),
  reasoning: z
    .string()
    .describe(
      "One sentence justifying the suspicion level for this specific candidate.",
    ),
});
export type ChunkEvaluation = z.infer<typeof ChunkEvaluationSchema>;

export const ChunkFindingSchema = z.object({
  suspectChunkIdx: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Index of the suspect chunk being evaluated. Echo back the value provided in the input.",
    ),
  evaluations: z
    .array(ChunkEvaluationSchema)
    .describe(
      "One evaluation per candidate presented to you. Include every candidate even if its suspicion is 'none'.",
    ),
});
export type ChunkFinding = z.infer<typeof ChunkFindingSchema>;

export const SynthesizedVerdictSchema = z.object({
  candidateDocId: z
    .string()
    .uuid()
    .describe(
      "UUID of the candidate Document this verdict applies to. Must match one of the docIds presented in the synthesis input.",
    ),
  label: VerdictLabelSchema.describe(
    "'plagiarism' = verbatim or near-verbatim copying of one or more suspect chunks from this document. 'paraphrase' = clear semantic reuse with rephrasing. 'no_match' = only weak or coincidental signals; consider omitting the verdict entirely instead of emitting no_match.",
  ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0.9+ = strong evidence (verbatim or near-verbatim across multiple chunks). 0.5 = ambiguous. Below 0.3 = weak signals only; usually pairs with 'no_match' or omission.",
    ),
  reasoning: z
    .string()
    .describe(
      "Two to four sentences justifying the label and confidence given the chunk-level findings.",
    ),
  evidence: z
    .array(EvidencePairSchema)
    .min(1)
    .max(5)
    .describe(
      "Between 1 and 5 strongest evidence pairs drawn from the chunk-level findings. Each pair must quote the actual suspect passage and the source passage verbatim, not paraphrase them.",
    ),
});
export type SynthesizedVerdict = z.infer<typeof SynthesizedVerdictSchema>;

export const SynthesisBatchSchema = z.object({
  verdicts: z
    .array(SynthesizedVerdictSchema)
    .describe(
      "One verdict per candidate Document worth reporting. Candidates with only 'low' or 'none' suspicion across every flagging chunk should be omitted entirely rather than included with a low-confidence no_match.",
    ),
});
export type SynthesisBatch = z.infer<typeof SynthesisBatchSchema>;
