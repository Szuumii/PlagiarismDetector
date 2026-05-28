// Anthropic judge client — M1 stub. Real tool-use implementation in M4.
// Returns a deterministic VerdictSchema-shaped object so the analyzer
// worker can persist Verdict rows against fake data today.

import { VerdictSchema, type Verdict } from "@repo/schemas";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

export interface JudgeRequest {
  suspectText: string;
  sourceText: string;
  model?: string;
}

export async function judge(_request: JudgeRequest): Promise<Verdict> {
  return VerdictSchema.parse({
    label: "no_match",
    confidence: 0,
    reasoning: "stub anthropic judge",
    evidence: [],
  });
}
