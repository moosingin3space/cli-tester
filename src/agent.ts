/**
 * The inner agent loop, on top of `@openrouter/agent`. A thin wrapper: it takes
 * instructions, an input prompt, and a toolset, streams tool activity to an
 * `onEvent` callback, and returns the final text and usage. The discovery phase
 * uses it; the test phase is deterministic and does not.
 */

import { OpenRouter } from "@openrouter/agent";
import type { Item } from "@openrouter/agent";
import { stepCountIs, maxCost } from "@openrouter/agent/stop-conditions";
import type { AgentConfig } from "./config.js";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; name: string; callId: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; callId: string; output: string }
  | { type: "done"; usage: unknown; durationMs: number };

export interface RunAgentOptions {
  instructions: string;
  input: string;
  tools: readonly unknown[];
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export async function runAgent(config: AgentConfig, opts: RunAgentOptions) {
  const startedAt = Date.now();
  const client = new OpenRouter({ apiKey: config.apiKey });

  const result = client.callModel({
    model: config.model,
    instructions: opts.instructions,
    input: opts.input as string | Item[],
    tools: opts.tools as Parameters<typeof client.callModel>[0]["tools"],
    stopWhen: [stepCountIs(config.maxSteps), maxCost(config.maxCost)],
  });

  const onAbort = () => result.cancel();
  opts.signal?.addEventListener("abort", onAbort);
  if (opts.signal?.aborted) result.cancel();

  let accumulatedText = "";

  try {
    if (opts.onEvent) {
      const callNames = new Map<string, string>();

      const streamText = async () => {
        for await (const delta of result.getTextStream()) {
          if (opts.signal?.aborted) break;
          opts.onEvent!({ type: "text", delta });
          accumulatedText += delta;
        }
      };

      const streamTools = async () => {
        for await (const item of result.getItemsStream()) {
          if (opts.signal?.aborted) break;
          if (item.type === "function_call") {
            callNames.set(item.callId, item.name);
            if (item.status === "completed") {
              const args = (() => {
                try {
                  return item.arguments ? JSON.parse(item.arguments) : {};
                } catch {
                  return {};
                }
              })();
              opts.onEvent!({ type: "tool_call", name: item.name, callId: item.callId, args });
            }
          } else if (item.type === "function_call_output") {
            const out = typeof item.output === "string" ? item.output : JSON.stringify(item.output);
            opts.onEvent!({
              type: "tool_result",
              name: callNames.get(item.callId) ?? "unknown",
              callId: item.callId,
              output: out.length > 300 ? out.slice(0, 300) + "…" : out,
            });
          }
        }
      };

      await Promise.all([streamText(), streamTools()]);
    }

    const response = await result.getResponse();
    const durationMs = Date.now() - startedAt;
    const text = accumulatedText || (response.outputText ?? "");
    opts.onEvent?.({ type: "done", usage: response.usage, durationMs });
    return { text, usage: response.usage, durationMs };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
