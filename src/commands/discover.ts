/**
 * Discovery phase: an agent plays with the CLI under test and logs what it
 * learns into the local fact database (Ascent Datalog).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const promptPath = join(__dirname, "../prompts/discover.md");
  const template = readFileSync(promptPath, "utf-8");
  return template
    .replace(/{target}/g, target)
    .replace(/{schema}/g, schemaText);
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
