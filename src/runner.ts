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
