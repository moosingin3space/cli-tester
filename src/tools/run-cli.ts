import { tool } from "@openrouter/agent/tool";
import { z } from "zod";
import { runTarget, splitArgv } from "../runner.js";

const MAX_SHOWN = 4000;

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_SHOWN) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_SHOWN) + "\n…[truncated]", truncated: true };
}

/**
 * The agent's hands: run the CLI under test. `args` is everything after the
 * target binary; the binary itself is fixed, so the agent can only exercise the
 * tool it was pointed at, never arbitrary programs.
 */
export function makeRunCliTool(target: string) {
  return tool({
    name: "run_cli",
    description:
      `Run the CLI under test (\`${target}\`) with the given arguments and observe ` +
      `its exit code, stdout, and stderr. Use this to explore what the tool does: ` +
      `try --help, subcommands, flags, and invalid input. Output is captured with a timeout.`,
    inputSchema: z.object({
      args: z
        .string()
        .describe(`Arguments after \`${target}\`, e.g. "status --short". Empty string runs it bare.`),
      timeoutMs: z.number().optional().describe("Wall-clock timeout in ms (default 10000)."),
    }),
    execute: async ({ args, timeoutMs }) => {
      const argv = splitArgv(args);
      const r = await runTarget(target, argv, timeoutMs ?? 10_000);
      const out = clip(r.stdout);
      const err = clip(r.stderr);
      return {
        argv: args,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        stdout: out.text,
        stdoutTruncated: out.truncated,
        stderr: err.text,
        stderrTruncated: err.truncated,
      };
    },
  });
}
