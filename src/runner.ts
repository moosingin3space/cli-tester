/**
 * Runs the CLI under test as a child process and captures its behavior. Used
 * both by the discovery agent's `run_cli` tool and by the deterministic `test`
 * verifier, so a discovered exit code and a replayed one are produced the same
 * way.
 */

import { spawn } from "node:child_process";

const MAX_CAPTURE = 64 * 1024;

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Splits an argv string into argument tokens, honoring single and double
 * quotes. A faithful round-trip of the `argv` symbol stored in the fact base.
 */
export function splitArgv(argv: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(argv)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1].replace(/\\(.)/g, "$1"));
    else if (m[2] !== undefined) tokens.push(m[2]);
    else if (m[3] !== undefined) tokens.push(m[3]);
  }
  return tokens;
}

/**
 * Spawns `target` with `args` (no shell — no injection), capturing stdout,
 * stderr, and the exit code, with a wall-clock timeout. Capture is bounded.
 */
export function runTarget(target: string, args: string[], timeoutMs = 10_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(target, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr + `\n[spawn error] ${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: stdout.slice(0, MAX_CAPTURE),
        stderr: stderr.slice(0, MAX_CAPTURE),
        timedOut,
      });
    });
  });
}

/** The file-tree delta a tracked invocation produced, as git sees it. */
export interface FileDelta {
  /** Paths that did not exist before and do now (untracked / added). */
  created: string[];
  /** Existing tracked paths whose content changed. */
  modified: string[];
  /** Tracked paths the invocation removed. */
  deleted: string[];
}

/** A {@link RunResult} plus the working-tree changes the run caused. */
export interface TrackedRunResult extends RunResult, FileDelta {}

/** Runs `git` with `args`, capturing its stdout/stderr and exit code. */
function runGit(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ code: null, stdout, stderr: stderr + err.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Thrown when file-change tracking cannot run because the git tree is unusable. */
export class GitTreeError extends Error {}

/**
 * Confirms the current directory is a git working tree with **no** uncommitted
 * or untracked changes, so anything observed afterward is the invocation's doing
 * and the reset afterward cannot clobber the caller's own work. Fails closed.
 */
async function assertCleanGitTree(): Promise<void> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    throw new GitTreeError("file-change tracking requires running inside a git working tree");
  }
  const status = await runGit(["status", "--porcelain", "-uall"]);
  if (status.code !== 0) throw new GitTreeError(`git status failed: ${status.stderr.trim()}`);
  if (status.stdout.trim() !== "") {
    throw new GitTreeError(
      "git working tree is not clean — commit, stash, or clean it before tracking file effects",
    );
  }
}

/** Unquotes a path as git renders it in `--porcelain` output (C-style quoting). */
function unquoteGitPath(p: string): string {
  let path = p;
  const arrow = path.indexOf(" -> "); // rename / copy: keep the destination
  if (arrow >= 0) path = path.slice(arrow + 4);
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return path;
}

/** Buckets `git status --porcelain -uall` lines into created/modified/deleted. */
function parseStatus(porcelain: string): FileDelta {
  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  for (const line of porcelain.split("\n")) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const path = unquoteGitPath(line.slice(3));
    if (x === "?" || x === "A") created.add(path);
    else if (x === "D" || y === "D") deleted.add(path);
    else modified.add(path); // M, R, C, T, … on either side
  }
  return { created: [...created].sort(), modified: [...modified].sort(), deleted: [...deleted].sort() };
}

/** Restores the working tree to its clean HEAD state, discarding the run's effects. */
async function resetGitTree(): Promise<void> {
  const head = await runGit(["rev-parse", "--verify", "-q", "HEAD"]);
  if (head.code === 0) await runGit(["reset", "--hard", "-q"]); // no HEAD yet => nothing to reset to
  await runGit(["clean", "-fdq"]);
}

/**
 * Like {@link runTarget}, but observes which files the invocation created,
 * modified, or deleted, using git as the snapshot mechanism, then resets the
 * tree so the next call starts clean.
 *
 * Requires a clean git working tree (see {@link assertCleanGitTree}); throws
 * {@link GitTreeError} otherwise. The reset (`git reset --hard` + `git clean`)
 * only ever discards what the invocation itself produced.
 */
export async function runTargetTracked(
  target: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<TrackedRunResult> {
  await assertCleanGitTree();
  const result = await runTarget(target, args, timeoutMs);
  const status = await runGit(["status", "--porcelain", "-uall"]);
  const delta = status.code === 0 ? parseStatus(status.stdout) : { created: [], modified: [], deleted: [] };
  await resetGitTree();
  return { ...result, ...delta };
}
