/**
 * Testing phase: a deterministic verifier. It loads the fact database, replays
 * each recorded invocation against the *real* CLI, and checks the live behavior
 * matches what was recorded. No LLM — the verifier is deterministic and
 * fail-closed: any mismatch (or an indeterminate evaluation) is a failure.
 */

import { FactQueryError } from "@acastos/fact-query";
import { FactDb } from "../factdb.js";
import { type FileDelta, runTarget, runTargetTracked, splitArgv } from "../runner.js";

export interface TestOptions {
  target: string;
  dbPath: string;
  timeoutMs: number;
}

interface Check {
  argv: string;
  kind:
    | "exit_code"
    | "output_contains"
    | "mentions_path"
    | "missing_file"
    | "creates_file"
    | "modifies_file"
    | "deletes_file";
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
  // Path-bearing claims observed *through the tool's own output* (the discovery
  // agent has no filesystem access). Both are argv-keyed and verified the same
  // way: re-run argv and confirm the path is still referenced in the output. We
  // cannot independently re-confirm filesystem absence, so `missing_file` is
  // checked as "the tool still names this path", consistent with how it was
  // discovered. `config_file` is command-keyed (no argv to replay), so it is not
  // directly verified here.
  let expectedMentions: { argv: string; path: string }[] = [];
  let expectedMissing: { argv: string; path: string }[] = [];
  // File side-effects observed *directly* (via git). These argvs are replayed
  // with `runTargetTracked`, which requires a clean git tree and resets it after
  // each run; the recorded path must reappear in the matching delta bucket.
  let expectedCreates: { argv: string; path: string }[] = [];
  let expectedModifies: { argv: string; path: string }[] = [];
  let expectedDeletes: { argv: string; path: string }[] = [];
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

    if (relations.has("mentions_path")) {
      const mp = engine.query("(argv, path) <-- mentions_path(argv, path)");
      if (mp.truncated) throw new FactQueryError("mentions_path query hit the cardinality cap", "eval");
      expectedMentions = mp.rows.map((r) => ({ argv: r[0] as string, path: r[1] as string }));
    }

    if (relations.has("missing_file")) {
      const mf = engine.query("(argv, path) <-- missing_file(argv, path)");
      if (mf.truncated) throw new FactQueryError("missing_file query hit the cardinality cap", "eval");
      expectedMissing = mf.rows.map((r) => ({ argv: r[0] as string, path: r[1] as string }));
    }

    if (relations.has("creates_file")) {
      const cf = engine.query("(argv, path) <-- creates_file(argv, path)");
      if (cf.truncated) throw new FactQueryError("creates_file query hit the cardinality cap", "eval");
      expectedCreates = cf.rows.map((r) => ({ argv: r[0] as string, path: r[1] as string }));
    }

    if (relations.has("modifies_file")) {
      const mf = engine.query("(argv, path) <-- modifies_file(argv, path)");
      if (mf.truncated) throw new FactQueryError("modifies_file query hit the cardinality cap", "eval");
      expectedModifies = mf.rows.map((r) => ({ argv: r[0] as string, path: r[1] as string }));
    }

    if (relations.has("deletes_file")) {
      const df = engine.query("(argv, path) <-- deletes_file(argv, path)");
      if (df.truncated) throw new FactQueryError("deletes_file query hit the cardinality cap", "eval");
      expectedDeletes = df.rows.map((r) => ({ argv: r[0] as string, path: r[1] as string }));
    }
  } finally {
    engine.free();
  }

  // Argvs whose file side-effects we must verify — these are replayed *tracked*.
  const trackedArgvs = new Set<string>([
    ...expectedCreates.map((e) => e.argv),
    ...expectedModifies.map((e) => e.argv),
    ...expectedDeletes.map((e) => e.argv),
  ]);

  // The distinct argv lines we need to actually run.
  const argvs = new Set<string>([
    ...expectedExit.map((e) => e.argv),
    ...expectedSubstr.map((e) => e.argv),
    ...expectedMentions.map((e) => e.argv),
    ...expectedMissing.map((e) => e.argv),
    ...trackedArgvs,
  ]);
  if (argvs.size === 0) {
    process.stderr.write("No invocations recorded in the database — nothing to verify.\n");
    return 0;
  }

  // Run each distinct argv once and reuse the result across checks. Tracked runs
  // go first while the git tree is clean (each resets itself afterward); a single
  // tracked run also satisfies the exit-code / output checks for that argv. The
  // rest run plain. A dirty or missing git tree makes `runTargetTracked` throw —
  // fail-closed: the run aborts rather than report a file change unverified.
  const observed = new Map<string, Awaited<ReturnType<typeof runTarget>>>();
  const deltas = new Map<string, FileDelta>();
  for (const argv of trackedArgvs) {
    const r = await runTargetTracked(opts.target, splitArgv(argv), opts.timeoutMs);
    observed.set(argv, r);
    deltas.set(argv, { created: r.created, modified: r.modified, deleted: r.deleted });
  }
  for (const argv of argvs) {
    if (observed.has(argv)) continue;
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
  for (const { argv, path } of expectedMentions) {
    const r = observed.get(argv)!;
    const combined = r.stdout + r.stderr;
    checks.push({
      argv,
      kind: "mentions_path",
      expected: path,
      actual: combined.includes(path) ? "present" : "absent",
      pass: combined.includes(path),
    });
  }
  for (const { argv, path } of expectedMissing) {
    const r = observed.get(argv)!;
    const combined = r.stdout + r.stderr;
    checks.push({
      argv,
      kind: "missing_file",
      expected: path,
      actual: combined.includes(path) ? "present" : "absent",
      pass: combined.includes(path),
    });
  }
  for (const { argv, path } of expectedCreates) {
    const pass = deltas.get(argv)!.created.includes(path);
    checks.push({ argv, kind: "creates_file", expected: path, actual: pass ? "created" : "absent", pass });
  }
  for (const { argv, path } of expectedModifies) {
    const pass = deltas.get(argv)!.modified.includes(path);
    checks.push({ argv, kind: "modifies_file", expected: path, actual: pass ? "modified" : "absent", pass });
  }
  for (const { argv, path } of expectedDeletes) {
    const pass = deltas.get(argv)!.deleted.includes(path);
    checks.push({ argv, kind: "deletes_file", expected: path, actual: pass ? "deleted" : "absent", pass });
  }

  // Report.
  let passed = 0;
  for (const c of checks) {
    const mark = c.pass ? "PASS" : "FAIL";
    if (c.pass) passed++;
    let detail: string;
    switch (c.kind) {
      case "exit_code":
        detail = `exit ${c.expected} (got ${c.actual})`;
        break;
      case "output_contains":
        detail = `output contains ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
      case "mentions_path":
        detail = `output mentions path ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
      case "missing_file":
        detail = `output reports missing file ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
      case "creates_file":
        detail = `creates file ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
      case "modifies_file":
        detail = `modifies file ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
      case "deletes_file":
        detail = `deletes file ${JSON.stringify(c.expected)} (${c.actual})`;
        break;
    }
    process.stdout.write(`[${mark}] ${opts.target} ${c.argv} :: ${detail}\n`);
  }

  const failed = checks.length - passed;
  process.stdout.write(`\n${passed}/${checks.length} checks passed${failed ? `, ${failed} FAILED` : ""}.\n`);
  return failed === 0 ? 0 : 1;
}
