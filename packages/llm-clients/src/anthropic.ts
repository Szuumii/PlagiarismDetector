import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@repo/config/env";
import { VerdictSchema, type Verdict } from "@repo/schemas";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_API_KEY = requireEnv('ANTHROPIC_API_KEY')

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const systemPrompt = `SystemPrompt`

export interface JudgeRequest {
  suspectText: string;
  sourceText: string;
  model?: string;
}

export async function judge(_request: JudgeRequest): Promise<Verdict> {
  const message = await client.messages.create({
    max_tokens: 1000,
    model: ANTHROPIC_DEFAULT_MODEL,
    system: systemPrompt,
    messages: [{ role: 'user', content: "Hello Claude" }],
    tools: []
  })

  return VerdictSchema.parse({
    label: "no_match",
    confidence: 0,
    reasoning: "stub anthropic judge",
    evidence: [],
  });
}
