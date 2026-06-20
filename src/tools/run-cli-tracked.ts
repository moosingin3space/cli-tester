import { tool } from "@openrouter/agent/tool";
import { z } from "zod";
import { GitTreeError, runTargetTracked, splitArgv } from "../runner.js";

const MAX_SHOWN = 4000;

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_SHOWN) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_SHOWN) + "\n…[truncated]", truncated: true };
}

/**
 * Like {@link makeRunCliTool}, but also reports the working-tree changes the
 * invocation caused — which files it created, modified, or deleted — observed
 * directly through git. The agent turns these into `creates_file` /
 * `modifies_file` / `deletes_file` facts.
 *
 * The working tree must be **clean** (no uncommitted or untracked changes): the
 * tool snapshots via git, runs the target, reads the delta, then resets the tree
 * with `git reset --hard` + `git clean`, so every call starts from the same
 * clean state and the reset only ever discards what the target itself produced.
 */
export function makeRunCliTrackedTool(target: string) {
  return tool({
    name: "run_cli_tracked",
    description:
      `Run \`${target}\` and observe which files it CREATES, MODIFIES, or DELETES in the ` +
      `working directory (detected via git), in addition to its exit code and output. Use ` +
      `this to characterize a command's file side effects — then record creates_file / ` +
      `modifies_file / deletes_file for the reported paths. Requires a clean git working ` +
      `tree; the tree is reset after each run, so repeated calls are safe and start clean.`,
    inputSchema: z.object({
      args: z
        .string()
        .describe(`Arguments after \`${target}\`, e.g. "init". Empty string runs it bare.`),
      timeoutMs: z.number().optional().describe("Wall-clock timeout in ms (default 10000)."),
    }),
    execute: async ({ args, timeoutMs }) => {
      try {
        const argv = splitArgv(args);
        const r = await runTargetTracked(target, argv, timeoutMs ?? 10_000);
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
          created: r.created,
          modified: r.modified,
          deleted: r.deleted,
        };
      } catch (e) {
        // A dirty / missing git tree is a usage error the agent can correct, not a crash.
        if (e instanceof GitTreeError) return { error: e.message };
        return { error: (e as Error).message };
      }
    },
  });
}
