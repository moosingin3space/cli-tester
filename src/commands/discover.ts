/**
 * Discovery phase: an agent plays with the CLI under test and logs what it
 * learns into the local fact database (Ascent Datalog).
 */

import { existsSync } from "node:fs";
import { FactEngine } from "@acastos/fact-query";
import type { AgentConfig } from "../config.js";
import { FactDb } from "../factdb.js";
import { discoverTools } from "../tools/index.js";
import { runAgent, type AgentEvent } from "../agent.js";

export interface DiscoverOptions {
  target: string;
  dbPath: string;
  task?: string;
}

function instructions(target: string, schemaText: string): string {
  return [
    `You are characterizing the behavior of the command-line tool \`${target}\`.`,
    "Your job: explore it empirically and record what you observe as facts.",
    "",
    "Method:",
    `- Use run_cli to invoke \`${target}\` with various arguments. Start with --help`,
    "  and -h, then explore subcommands, their flags, and a few invalid inputs.",
    "- For every meaningful invocation, use record_fact to log what you observed:",
    "  the subcommand, its flags, the exact argv and its exit code, and notable",
    "  output substrings (stable ones — version numbers, usage banners, error",
    "  messages — not timestamps or paths that vary run to run).",
    "- Only assert what you actually observed by running the tool. Never guess.",
    "- Periodically use query_facts to review what you have recorded.",
    "",
    "The fact schema (relations you may record into):",
    schemaText,
    "",
    "Notes:",
    "- `invocation(argv, exit_code)`: argv is everything AFTER the binary name,",
    `  e.g. "status --short" (not "${target} status --short").`,
    "- `output_contains(argv, substring)`: a substring you saw in stdout or stderr",
    "  for that exact argv.",
    "",
    "Be thorough but finite. When you have covered the tool's surface, stop and",
    "give a short summary of what the tool does and how many facts you recorded.",
  ].join("\n");
}

export async function discover(config: AgentConfig, opts: DiscoverOptions): Promise<void> {
  const db = existsSync(opts.dbPath) ? await FactDb.load(opts.dbPath) : new FactDb();
  if (db.size > 0) {
    process.stderr.write(`Loaded ${db.size} existing fact(s) from ${opts.dbPath}\n`);
  }

  // Build a probe engine purely to obtain the authoritative schema for the
  // tools and the prompt.
  const probe = FactEngine.fromSource(db.schema);
  const schema = probe.schema().relations;
  probe.free();
  const schemaText = schema.map((r) => `  ${r.name}(${r.columns.join(", ")})`).join("\n");

  const tools = discoverTools({ db, target: opts.target, schema });

  const input =
    opts.task ?? `Explore and characterize \`${opts.target}\`. Record everything you learn.`;

  const onEvent = (e: AgentEvent) => {
    if (e.type === "tool_call") {
      process.stderr.write(`  → ${e.name}(${JSON.stringify(e.args).slice(0, 160)})\n`);
    } else if (e.type === "done") {
      process.stderr.write(`\n[done in ${(e.durationMs / 1000).toFixed(1)}s]\n`);
    }
  };

  process.stderr.write(`Discovering \`${opts.target}\`…\n`);
  const { text } = await runAgent(config, {
    instructions: instructions(opts.target, schemaText),
    input,
    tools,
    onEvent,
  });

  await db.save(opts.dbPath);
  process.stderr.write(`\nWrote ${db.size} fact(s) to ${opts.dbPath}\n`);
  if (text.trim()) process.stdout.write(text.trim() + "\n");
}
