import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@repo/config/env";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export interface CallToolArgs {
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: object;
}

export async function callTool(args: CallToolArgs): Promise<unknown> {
  const t0 = Date.now();
  console.log(`[anthropic:fetch] firing tool=${args.toolName}`);

  const response = await client.messages.create({
    model: ANTHROPIC_DEFAULT_MODEL,
    max_tokens: 2000,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userMessage }],
    tools: [
      {
        name: args.toolName,
        description: args.toolDescription,
        input_schema: args.toolInputSchema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: args.toolName },
  });

  const elapsed = Date.now() - t0;

  const block = response.content.find(
    (b) => b.type === "tool_use" && b.name === args.toolName,
  );

  if (!block || block.type !== "tool_use") {
    console.error(
      `[anthropic:fetch] no tool_use block in response (elapsed=${elapsed}ms)`,
      JSON.stringify(response.content),
    );
    throw new Error(
      `anthropic: no tool_use block named "${args.toolName}" in response`,
    );
  }

  console.log(`[anthropic:fetch] status=ok elapsed=${elapsed}ms`);
  return block.input;
}
