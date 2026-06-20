/**
 * The local fact database, stored in Ascent Datalog format.
 *
 * The {@link https://github.com/moosingin3space/acastos-fact-query | acastos}
 * engine (`@acastos/fact-query`) only accepts relation declarations and rules
 * (`head <-- body`) through {@link FactEngine.fromSource}; its parser rejects
 * body-less rules, so **ground facts cannot live in the program text** and must
 * enter through `addFact`. A `.dl` file written by this tool therefore has two
 * regions, both valid-looking Ascent Datalog:
 *
 * 1. the *schema* — `relation` declarations and rules — fed to `fromSource`;
 * 2. the *facts* — ground atoms like `invocation("status", 0).` — fed to
 *    `addFact`.
 *
 * {@link FactDb.load} splits the two; {@link FactDb.save} writes them back. The
 * file round-trips and stays readable as plain Datalog.
 */

import { readFile, writeFile } from "node:fs/promises";
import { FactEngine, FactQueryError, type FactValueInput } from "@acastos/fact-query";

/**
 * The vocabulary the agent populates. This is governance-free: it describes
 * *observed CLI behavior*, nothing about whether that behavior is allowed.
 *
 * - `command(name)` — a subcommand / capability the tool exposes.
 * - `flag(command, flag)` — a flag accepted under a command.
 * - `invocation(argv, exit_code)` — an argument line (everything after the
 *   target binary) and the exit code it was observed to produce.
 * - `output_contains(argv, substring)` — a substring observed in the combined
 *   stdout+stderr of that argument line.
 * - `characterized(argv)` — derived: argument lines we have an exit code for.
 */
export const DEFAULT_SCHEMA = `relation command(sym);
relation flag(sym, sym);
relation invocation(sym, int);
relation output_contains(sym, sym);
relation characterized(sym);
characterized(a) <-- invocation(a, code);`;

/** A ground fact: a relation name plus its column values. */
export interface Fact {
  relation: string;
  values: FactValueInput[];
}

/** Formats a single column value as an Ascent Datalog literal. */
function formatValue(v: FactValueInput): string {
  switch (typeof v) {
    case "bigint":
      return v.toString();
    case "number":
      if (!Number.isInteger(v)) throw new TypeError(`integer column must be an integer, got ${v}`);
      return v.toString();
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    default:
      throw new TypeError(`unsupported column value of type ${typeof v}`);
  }
}

/** Parses the argument list inside `rel(...)` into column values. */
function parseArgs(inner: string): FactValueInput[] {
  const values: FactValueInput[] = [];
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && /\s/.test(inner[i]!)) i++;
    if (i >= n) break;
    if (inner[i] === '"') {
      i++;
      let s = "";
      while (i < n && inner[i] !== '"') {
        if (inner[i] === "\\" && i + 1 < n) {
          i++;
          s += inner[i];
        } else {
          s += inner[i];
        }
        i++;
      }
      if (i >= n) throw new Error(`unterminated string in: ${inner}`);
      i++; // closing quote
      values.push(s);
    } else {
      let tok = "";
      while (i < n && inner[i] !== ",") tok += inner[i++];
      tok = tok.trim();
      if (tok === "true") values.push(true);
      else if (tok === "false") values.push(false);
      else if (/^-?\d+$/.test(tok)) values.push(BigInt(tok));
      else throw new Error(`unrecognized value token "${tok}" in: ${inner}`);
    }
    while (i < n && /\s/.test(inner[i]!)) i++;
    if (i < n && inner[i] === ",") i++;
  }
  return values;
}

const FACT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)\s*[.;]?\s*$/;

/** A local fact database: a fixed Ascent program plus the facts gathered so far. */
export class FactDb {
  /** Relation declarations + rules — the `fromSource` program. */
  readonly schema: string;
  private readonly facts: Fact[] = [];
  private readonly seen = new Set<string>();

  constructor(schema: string = DEFAULT_SCHEMA) {
    this.schema = schema;
  }

  /** Loads a `.dl` file, splitting schema (decls + rules) from ground facts. */
  static async load(path: string): Promise<FactDb> {
    const text = await readFile(path, "utf-8");
    const schemaLines: string[] = [];
    const factLines: string[] = [];

    for (const raw of text.split("\n")) {
      // Strip `%` and `//` line comments; keep everything before them.
      let line = raw.replace(/%.*$/, "");
      const slash = line.indexOf("//");
      if (slash >= 0) line = line.slice(0, slash);
      line = line.trim();
      if (!line) continue;

      if (line.startsWith("relation ") || line.startsWith("lattice ") || line.includes("<--")) {
        schemaLines.push(line);
      } else {
        factLines.push(line);
      }
    }

    const db = new FactDb(schemaLines.length ? schemaLines.join("\n") : DEFAULT_SCHEMA);
    for (const line of factLines) {
      const m = FACT_RE.exec(line);
      if (!m) throw new Error(`malformed fact line: ${line}`);
      db.add(m[1]!, parseArgs(m[2]!));
    }
    return db;
  }

  /** Records a ground fact, de-duplicating identical tuples. */
  add(relation: string, values: FactValueInput[]): void {
    const key = `${relation}(${values.map(formatValue).join(",")})`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.facts.push({ relation, values });
  }

  /** All facts gathered so far (a copy). */
  allFacts(): Fact[] {
    return this.facts.map((f) => ({ relation: f.relation, values: [...f.values] }));
  }

  /** Number of distinct facts. */
  get size(): number {
    return this.facts.length;
  }

  /** Serializes to Ascent Datalog text: schema block, then sorted facts. */
  serialize(): string {
    const factText = this.facts
      .map((f) => `${f.relation}(${f.values.map(formatValue).join(", ")}).`)
      .sort()
      .join("\n");
    return [
      "% cli-tester fact database (Ascent Datalog)",
      "% --- schema: relations + rules (fed to FactEngine.fromSource) ---",
      this.schema,
      "",
      "% --- facts: ground atoms (fed to FactEngine.addFact) ---",
      factText,
      "",
    ].join("\n");
  }

  /** Writes the database to `path`. */
  async save(path: string): Promise<void> {
    await writeFile(path, this.serialize(), "utf-8");
  }

  /**
   * Builds a fresh {@link FactEngine} from the schema, ingests every fact, and
   * runs to a fixed point — ready to {@link FactEngine.query}.
   *
   * @throws {@link FactQueryError} (stage `engine`) on a bad schema or fact.
   */
  toEngine(): FactEngine {
    let engine: FactEngine;
    try {
      engine = FactEngine.fromSource(this.schema);
    } catch (err) {
      if (err instanceof FactQueryError) throw err;
      throw new FactQueryError(`failed to build engine: ${(err as Error).message}`, "engine");
    }
    engine.addFacts(this.facts);
    engine.run();
    return engine;
  }
}

/** A JSON `replacer` that renders `bigint` columns as decimal strings. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
