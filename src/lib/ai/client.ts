import Anthropic from "@anthropic-ai/sdk";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  cached ??= new Anthropic();
  return cached;
}

/**
 * Forced tool-use call: defines a single tool, forces Claude to call it, and
 * returns the tool input. This is the portable way to get structured JSON out
 * of the Messages API on this SDK version.
 */
export async function callStructuredTool<T>(opts: {
  model: string;
  maxTokens: number;
  system?: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
}): Promise<T> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: opts.inputSchema as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.prompt }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Model did not return a tool call");
  }
  return block.input as T;
}
