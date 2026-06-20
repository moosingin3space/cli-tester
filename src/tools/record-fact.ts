import { tool } from "@openrouter/agent/tool";
import { z } from "zod";
import type { RelationSchema } from "@acastos/fact-query";
import type { FactDb } from "../factdb.js";

/**
 * Lets the agent persist a discovered fact into the database. The fact is
 * validated against the schema (relation, arity, and per-column JS type) so the
 * agent gets immediate feedback instead of a deferred engine error.
 */
export function makeRecordFactTool(db: FactDb, schema: RelationSchema[]) {
  const byName = new Map(schema.map((r) => [r.name, r]));

  return tool({
    name: "record_fact",
    description:
      "Record one observed fact about the CLI into the local fact database. " +
      "Only assert what you have actually observed by running the tool. Schema:\n" +
      schema.map((r) => `  ${r.name}(${r.columns.join(", ")})`).join("\n"),
    inputSchema: z.object({
      relation: z.string().describe("The relation name, e.g. invocation"),
      values: z
        .array(z.union([z.string(), z.number(), z.boolean()]))
        .describe("Column values in order. int=number, bool=boolean, sym=string."),
    }),
    execute: async ({ relation, values }) => {
      const rel = byName.get(relation);
      if (!rel) {
        return { error: `unknown relation "${relation}". Known: ${[...byName.keys()].join(", ")}` };
      }
      if (values.length !== rel.columns.length) {
        return { error: `relation ${relation} has arity ${rel.columns.length}, got ${values.length}` };
      }
      for (let i = 0; i < rel.columns.length; i++) {
        const col = rel.columns[i]!;
        const v = values[i]!;
        const ok =
          (col === "int" && typeof v === "number" && Number.isInteger(v)) ||
          (col === "bool" && typeof v === "boolean") ||
          (col === "sym" && typeof v === "string");
        if (!ok) {
          return { error: `column ${i} of ${relation} is ${col}, got ${typeof v} (${JSON.stringify(v)})` };
        }
      }
      const before = db.size;
      db.add(relation, values);
      return { ok: true, added: db.size > before, totalFacts: db.size };
    },
  });
}
