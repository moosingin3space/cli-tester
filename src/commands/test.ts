/**
 * Testing phase: a deterministic verifier. It loads the fact database, replays
 * each recorded invocation against the *real* CLI, and checks the live behavior
 * matches what was recorded. No LLM — the verifier is deterministic and
 * fail-closed: any mismatch (or an indeterminate evaluation) is a failure.
 */

import { FactQueryError } from "@acastos/fact-query";
import { FactDb } from "../factdb.js";
import { runTarget, splitArgv } from "../runner.js";

export interface TestOptions {
  target: string;
  dbPath: string;
  timeoutMs: number;
}

interface Check {
  argv: string;
  kind: "exit_code" | "output_contains";
  expected: string;
  actual: string;
  pass: boolean;
}

/** Returns the process exit code: 0 if every check passed, 1 otherwise. */
export async function test(opts: TestOptions): Promise<number> {
  const db = await FactDb.load(opts.dbPath);
  const engine = db.toEngine();

  let expectedExit: { argv: string; code: bigint }[] = [];
  let expectedSubstr: { argv: string; substring: string }[] = [];
  try {
    const relations = new Set(engine.schema().relations.map((r) => r.name));

    if (relations.has("invocation")) {
      const inv = engine.query("(argv, code) <-- invocation(argv, code)");
      if (inv.truncated) throw new FactQueryError("invocation query hit the cardinality cap", "eval");
      expectedExit = inv.rows.map((r) => ({ argv: r[0] as string, code: r[1] as bigint }));
    }

    if (relations.has("output_contains")) {
      const out = engine.query("(argv, sub) <-- output_contains(argv, sub)");
      if (out.truncated) throw new FactQueryError("output_contains query hit the cardinality cap", "eval");
      expectedSubstr = out.rows.map((r) => ({ argv: r[0] as string, substring: r[1] as string }));
    }
  } finally {
    engine.free();
  }

  // The distinct argv lines we need to actually run.
  const argvs = new Set<string>([...expectedExit.map((e) => e.argv), ...expectedSubstr.map((e) => e.argv)]);
  if (argvs.size === 0) {
    process.stderr.write("No invocations recorded in the database — nothing to verify.\n");
    return 0;
  }

  // Run each distinct argv once and reuse the result across checks.
  const observed = new Map<string, Awaited<ReturnType<typeof runTarget>>>();
  for (const argv of argvs) {
    observed.set(argv, await runTarget(opts.target, splitArgv(argv), opts.timeoutMs));
  }

  const checks: Check[] = [];
  for (const { argv, code } of expectedExit) {
    const r = observed.get(argv)!;
    const actual = r.timedOut ? "timeout" : String(r.exitCode);
    checks.push({ argv, kind: "exit_code", expected: String(code), actual, pass: actual === String(code) });
  }
  for (const { argv, substring } of expectedSubstr) {
    const r = observed.get(argv)!;
    const combined = r.stdout + r.stderr;
    checks.push({
      argv,
      kind: "output_contains",
      expected: substring,
      actual: combined.includes(substring) ? "present" : "absent",
      pass: combined.includes(substring),
    });
  }

  // Report.
  let passed = 0;
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    if (c.pass) passed++;
    const detail =
      c.kind === "exit_code"
        ? `exit ${c.expected} (got ${c.actual})`
        : `output contains ${JSON.stringify(c.expected)} (${c.actual})`;
    process.stdout.write(`[${mark}] ${opts.target} ${c.argv} :: ${detail}\n`);
  }

  const failed = checks.length - passed;
  process.stdout.write(`\n${passed}/${checks.length} checks passed${failed ? `, ${failed} FAILED` : ""}.\n`);
  return failed === 0 ? 0 : 1;
}
