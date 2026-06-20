import { tool } from "@openrouter/agent/tool";
import { z } from "zod";
import { FactQueryError } from "@acastos/fact-query";
import { bigintReplacer, type FactDb } from "../factdb.js";

/**
 * Lets the agent read back what it has recorded, via the acastos queries grain:
 * a conjunctive query is parsed, form-checked, and evaluated under a bound, with
 * provenance. This is the propose-then-verify shape — the agent proposes a query
 * and gets deterministic, evidence-carrying rows back (or a stage-tagged error).
 */
export function makeQueryFactsTool(db: FactDb) {
  return tool({
    name: "query_facts",
    description:
      "Run a conjunctive Datalog query against the facts recorded so far and get " +
      "the rows back with provenance. Form: `(out1, out2) <-- atom(a, b), atom2(b, c)`. " +
      "Lowercase identifiers are variables; every output variable must appear in the body.",
    inputSchema: z.object({
      query: z.string().describe('e.g. "(argv, code) <-- invocation(argv, code)"'),
      maxCardinality: z.number().optional().describe("Cap on returned rows (default 10000)."),
    }),
    execute: async ({ query, maxCardinality }) => {
      let engine;
      try {
        engine = db.toEngine();
      } catch (err) {
        const e = err as FactQueryError;
        return { error: e.message, stage: e.stage ?? "engine" };
      }
      try {
        const result = engine.query(query, maxCardinality ?? 10_000);
        // Round-trip through the bigint-aware replacer so the LLM sees decimals.
        return JSON.parse(JSON.stringify(result, bigintReplacer));
      } catch (err) {
        if (err instanceof FactQueryError) return { error: err.message, stage: err.stage };
        return { error: (err as Error).message, stage: "engine" };
      } finally {
        engine.free();
      }
    },
  });
}
