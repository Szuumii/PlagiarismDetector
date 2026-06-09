import { createAnthropic } from "@ai-sdk/anthropic";
import { requireEnv } from "@repo/config/env";
import { Output, generateText } from "ai";
import type { z } from "zod";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");

const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });

export interface GenerateStructuredArgs<S extends z.ZodType> {
  systemPrompt: string;
  userMessage: string;
  schema: S;
  schemaName?: string;
  schemaDescription?: string;
}

export async function generateStructured<S extends z.ZodType>(
  args: GenerateStructuredArgs<S>,
): Promise<z.infer<S>> {
  const t0 = Date.now();
  console.log(`[anthropic:fetch] firing schema=${args.schemaName ?? "object"}`);

  const { output } = await generateText({
    model: anthropic(ANTHROPIC_DEFAULT_MODEL),
    output: Output.object({
      schema: args.schema,
      name: args.schemaName,
      description: args.schemaDescription,
    }),
    system: args.systemPrompt,
    prompt: args.userMessage,
    maxOutputTokens: 2000,
  });

  console.log(`[anthropic:fetch] status=ok elapsed=${Date.now() - t0}ms`);
  return output as z.infer<S>;
}
