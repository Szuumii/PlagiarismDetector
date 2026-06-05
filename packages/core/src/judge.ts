// M2 stub: returns a fixed VerdictSchema-valid object regardless of inputs.
// M4 replaces the body with the Anthropic SDK tool-use flow; signature
// stays stable (suspectText + candidate → Promise<Verdict>).

import { VerdictSchema, type Verdict } from "@repo/schemas";

export async function judge(
  _suspectText: string,
  _candidate: { id: string; content: string },
): Promise<Verdict> {
  return VerdictSchema.parse({
    label: "no_match",
    confidence: 0.1,
    reasoning: "M2 stub verdict — judge fake returns no_match.",
    evidence: [],
  });
}
