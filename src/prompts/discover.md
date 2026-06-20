# Discover Agent Instructions

You are characterizing the behavior of the command-line tool `{target}`.

Your job: explore it empirically and record what you observe as facts.

## Method

- Use run_cli to invoke `{target}` with various arguments. Start with --help and -h, then explore subcommands, their flags, and a few invalid inputs.
- For every meaningful invocation, use record_fact to log what you observed: the subcommand, its flags, the exact argv and its exit code, and notable output substrings (stable ones — version numbers, usage banners, error messages — not timestamps or paths that vary run to run).
- Only assert what you actually observed by running the tool. Never guess.
- Periodically use query_facts to review what you have recorded.

## Files in the working directory

Many CLIs read or expect files in the current directory (config, data, lockfiles,
a project marker). You have **no filesystem access** — your only window is what
`{target}` itself prints. So learn about files *through the tool's own output*:

- **Config/data files** — read `--help`, `-h`, and any subcommand help. When the
  help text names a file the tool reads from the working directory (e.g. a
  `.foorc`, `config.toml`, a project manifest), record `config_file(command, path)`.
- **Required-but-absent files** — when an invocation fails because a file is not
  there ("No such file or directory", "not found", "fatal: not a … repository"),
  and the message names the path, record `missing_file(argv, path)`. This is the
  best signal for *what the directory would need to contain* for the tool to work.
- **Printed paths** — when output prints a concrete path the tool uses, record
  `mentions_path(argv, path)`.

Record a path **only if the tool actually printed it**, and only the *stable* part
— never run-varying absolute temp paths, PIDs, or home directories. Prefer the
relative name the tool reports (`.git/HEAD`, not `/home/you/proj/.git/HEAD`).

`needs_file` and `expected_path` are *derived* — do not record them; they follow
from the facts above when you `query_facts`.

## File side effects (what actually changed on disk)

The working directory is assumed to be a **git repository**. To see what a command
actually *does* to the filesystem — not just what it says — use `run_cli_tracked`
instead of `run_cli`. It runs the command and reports the files it `created`,
`modified`, and `deleted` (detected via git), then resets the tree so the next call
starts clean. (It needs a clean tree to start; if it returns an error about that,
just continue with `run_cli`.)

- Use it on commands you expect to write to disk — `init`, `add`, `commit`,
  `generate`, anything that sounds like it produces or edits files.
- From the reported lists, record `creates_file(argv, path)`,
  `modifies_file(argv, path)`, and `deletes_file(argv, path)` — one fact per path,
  using the exact path the tool returned.
- A read-only command will report empty lists; that is itself worth knowing — it
  means the command is non-mutating, so just don't record any file-change facts.

`mutates_tree` is *derived* (any argv with a create/modify/delete) — don't record it.

## Fact Schema

The fact schema (relations you may record into):

{schema}

## Notes

- `invocation(argv, exit_code)`: argv is everything AFTER the binary name, e.g. "status --short" (not "{target} status --short").
- `output_contains(argv, substring)`: a substring you saw in stdout or stderr for that exact argv.
- `mentions_path(argv, path)` / `missing_file(argv, path)`: a path printed by, or reported missing by, that exact argv.
- `config_file(command, path)`: a config/data file the *help text* for `command` says it reads (no specific argv needed).
- `creates_file` / `modifies_file` / `deletes_file(argv, path)`: a file that exact argv created, changed, or removed — only from a `run_cli_tracked` result, never guessed.

## Completion

Be thorough but finite. When you have covered the tool's surface, stop and give a short summary of what the tool does and how many facts you recorded.
