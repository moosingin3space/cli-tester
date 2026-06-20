# cli-tester
CLI testing tool powered by Neurosymbolic AI

## Architectural overview

This tool is aimed at ensuring CLI tool behavior is well documented
and understood. It consists of two phases:

1. *Discovery* :: an agent plays with the CLI tool and determines what
   it can do, logging information into an [Acastos](https://github.com/moosingin3space/acastos-fact-query) fact database.
2. *Testing* :: validates the CLI's real-world behavior against said database.

This app uses the OpenRouter Agents SDK.

## Setup

Requires Node ≥ 20. The fact engine ([`@acastos/fact-query`](https://github.com/moosingin3space/acastos-fact-query))
is consumed as a local file dependency; its WebAssembly must already be built
(see that repo's `just node-build`).

```sh
npm install
cp .env.example .env   # then add your OPENROUTER_API_KEY
```

Only the *discover* phase calls an LLM and needs `OPENROUTER_API_KEY`. *test* is
a deterministic verifier and runs without one.

## Usage

```sh
# 1. Discovery — an agent explores the CLI and writes the fact database.
npx tsx src/cli.ts discover <target> [--db facts.dl] [--task "..."]

# 2. Testing — replay the recorded behavior against the real CLI.
npx tsx src/cli.ts test <target> [--db facts.dl]
```

After `npm link`, the same commands are available as `cli-tester discover …` /
`cli-tester test …`. `test` exits non-zero if any recorded behavior no longer
holds (fail-closed).

Example:

```sh
cli-tester discover git --db git.dl     # agent characterizes `git`
cli-tester test     git --db git.dl     # verify `git` still behaves that way
```

## The fact database (Ascent Datalog)

The database is a plain-text Ascent Datalog file with two regions: a **schema**
(relation declarations + rules, fed to the engine's `fromSource`) and the
**facts** (ground atoms, ingested via `addFact` — the engine's parser rejects
body-less rules, so facts cannot live in the program text). `src/factdb.ts`
splits and rejoins the two, so the file round-trips and stays readable.

The default vocabulary (governance-free — it describes *observed behavior*, not
whether behavior is allowed):

| Relation | Meaning |
| --- | --- |
| `command(name)` | a subcommand / capability the tool exposes |
| `flag(command, flag)` | a flag accepted under a command |
| `invocation(argv, exit_code)` | an argument line and the exit code it produced |
| `output_contains(argv, substring)` | a substring seen in that argv's output |
| `mentions_path(argv, path)` | a filesystem path the tool printed for that argv |
| `missing_file(argv, path)` | a path that argv reported as absent ("No such file") |
| `config_file(command, path)` | a config/data file the command's help says it reads |
| `creates_file(argv, path)` | a file that argv created in the working tree (via git) |
| `modifies_file(argv, path)` | a tracked file that argv changed |
| `deletes_file(argv, path)` | a tracked file that argv removed |
| `characterized(argv)` | *derived* — argv lines with a known exit code |
| `needs_file(command, path)` | *derived* — a command that relies on a `config_file` |
| `expected_path(path)` | *derived* — a path the working directory is expected to provide |
| `mutates_tree(argv)` | *derived* — argv lines with any working-tree side effect |

## How it maps to the substrate

`discover` is the **proposer**: the agent runs the tool (`run_cli`), records what
it sees (`record_fact`), and can read it back through the acastos *queries grain*
(`query_facts`), which parses, form-checks, and bounded-evaluates a conjunctive
query with provenance. `test` is the **verifier**: deterministic replay against
the real CLI, fail-closed on any mismatch. No policy lives in either phase — that
is the substrate's governance-free guarantee.
