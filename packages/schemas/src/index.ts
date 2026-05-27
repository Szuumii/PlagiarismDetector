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
// orgId travels on every job — the schema is multi-tenant from day 1.

export const IndexDocumentJobSchema = z.object({
  orgId: z.string(),
  libraryId: z.string(),
  documentId: z.string(),
  objectKey: z.string(),
});
export type IndexDocumentJob = z.infer<typeof IndexDocumentJobSchema>;

export const AnalyzeSuspectJobSchema = z.object({
  orgId: z.string(),
  analysisJobId: z.string(),
  objectKey: z.string(),
});
export type AnalyzeSuspectJob = z.infer<typeof AnalyzeSuspectJobSchema>;
