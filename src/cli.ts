#!/usr/bin/env -S npx tsx
/**
 * cli-tester — CLI testing tool powered by Neurosymbolic AI.
 *
 *   cli-tester discover <target> [options]   # agent explores, writes the fact DB
 *   cli-tester test     <target> [options]   # deterministic verifier reads it
 *
 * The fact database is a local Ascent Datalog file (default ./facts.dl).
 */

import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { discover } from "./commands/discover.js";
import { test } from "./commands/test.js";

const USAGE = `cli-tester — characterize and verify a CLI tool against a local fact database.

Usage:
  cli-tester discover <target> [--db <file>] [--task <text>] [--model <id>]
                               [--max-steps <n>] [--max-cost <usd>]
  cli-tester test     <target> [--db <file>] [--timeout <ms>]

Phases:
  discover   An agent plays with <target>, logging observed behavior into the
             fact database (needs OPENROUTER_API_KEY).
  test       Replays the recorded invocations against the real <target> and
             checks the behavior still matches. Deterministic; no API key.

Options:
  --db <file>        Fact database path (default: ./facts.dl)
  --task <text>      Custom discovery instruction
  --model <id>       OpenRouter model (default: anthropic/claude-sonnet-4.6)
  --max-steps <n>    Max agent turns (default: 40)
  --max-cost <usd>   Max spend per run (default: 1.0)
  --timeout <ms>     Per-invocation timeout for test (default: 10000)
  -h, --help         Show this help
`;

function tryLoadEnv(): void {
  try {
    // Node >= 20.6
    (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile(".env");
  } catch {
    /* no .env file — fine */
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      db: { type: "string", default: "facts.dl" },
      task: { type: "string" },
      model: { type: "string" },
      "max-steps": { type: "string" },
      "max-cost": { type: "string" },
      timeout: { type: "string", default: "10000" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, target] = positionals;

  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command ? 0 : values.help ? 0 : 1;
  }
  if (command !== "discover" && command !== "test") {
    process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  if (!target) {
    process.stderr.write(`The \`${command}\` command needs a <target> CLI to test.\n\n${USAGE}`);
    return 1;
  }

  tryLoadEnv();

  if (command === "discover") {
    const overrides: Parameters<typeof loadConfig>[0] = {};
    if (values.model) overrides.model = values.model;
    if (values["max-steps"]) overrides.maxSteps = Number(values["max-steps"]);
    if (values["max-cost"]) overrides.maxCost = Number(values["max-cost"]);
    const config = loadConfig(overrides);
    await discover(config, { target, dbPath: values.db!, task: values.task });
    return 0;
  }

  // command === "test"
  return test({ target, dbPath: values.db!, timeoutMs: Number(values.timeout) });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const stage = (err as { stage?: string }).stage;
    process.stderr.write(`Error${stage ? ` [${stage}]` : ""}: ${(err as Error).message}\n`);
    process.exit(1);
  });
