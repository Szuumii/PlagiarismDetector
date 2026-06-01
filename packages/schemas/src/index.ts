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

export const ConfirmDocumentResponseSchema = z.object({
  enqueued: z.literal(true),
  jobId: z.string().uuid()
})
export type ConfirmDocumentResponse = z.infer<typeof ConfirmDocumentResponseSchema>

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
